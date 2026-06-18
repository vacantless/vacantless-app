"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { formatRentCents } from "@/lib/tenancy";
import {
  resolveCurrentClauses,
  buildLeaseVars,
  assembleClauses,
  buildExecutedSnapshot,
  selectClausesById,
  collectVarFields,
  tokensInBody,
  type ClauseRowLike,
  type ClauseVersionRowLike,
} from "@/lib/clauses";
import {
  renderLeaseDocumentHtml,
  type LeaseRenderModel,
} from "@/lib/lease-render";
import {
  deriveSigners,
  generateSignToken,
  hashDocument,
  canWithdraw,
} from "@/lib/lease-signing";
import { sendLeaseSignatureRequest } from "@/lib/email";
import { normalizeEmail } from "@/lib/persons";

// Generate a lease document for a tenancy from the operator's clause SELECTION
// (lease vault #11, slice 7 — the conversion wizard). The wizard submits the
// clause ids the operator chose (recommendation-driven, include/exclude) plus a
// var_<token> field per placeholder it asked them to fill. This re-resolves the
// org's current clause library server-side, intersects it with the submitted
// ids (so a forged/stale id can't assemble a clause outside the org's library),
// fills the record-derived tokens itself, and writes a lease_documents row that
// SNAPSHOTS exactly which clause version was in force — the anchor the renewal
// diff reads against. Guarded on manage_tenancies. Redirect-based.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function generateLeaseFromSelection(formData: FormData) {
  await requireCapability(
    "manage_tenancies",
    "/dashboard/tenancies?forbidden=1",
  );
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  const back = `/dashboard/tenancies/${tenancyId}`;

  const supabase = createClient();

  // The tenancy + unit + primary tenant supply the merge-field values.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, deposit_cents, start_date, end_date, property:properties(address), tenants(name, is_primary)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tenancyRow) redirect(`${back}?lease=notfound`);
  const tenancy = tenancyRow as unknown as {
    id: string;
    rent_cents: number | null;
    deposit_cents: number | null;
    start_date: string | null;
    end_date: string | null;
    property: { address: string } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };
  const primary =
    (tenancy.tenants ?? []).find((t) => t.is_primary) ??
    (tenancy.tenants ?? [])[0] ??
    null;

  // The org clause library (current versions only get assembled).
  const { data: clauseRows } = await supabase
    .from("lease_clauses")
    .select("id, key, title, applicable_to")
    .order("category", { ascending: true })
    .order("key", { ascending: true });
  const { data: versionRows } = await supabase
    .from("lease_clause_versions")
    .select("id, clause_id, version, is_current, body");

  const resolved = resolveCurrentClauses(
    (clauseRows ?? []) as ClauseRowLike[],
    (versionRows ?? []) as ClauseVersionRowLike[],
  );
  if (resolved.length === 0) redirect(`${back}?lease=noclauses`);

  // Only the clauses the operator chose, intersected with the live library and
  // kept in library order (forged/stale ids drop out).
  const selectedIds = formData.getAll("clause_id").map((v) => String(v));
  const selected = selectClausesById(resolved, selectedIds);
  if (selected.length === 0) redirect(`${back}?lease=noselection`);

  // Record-derived tokens fill automatically; operator-supplied placeholders
  // come from the var_<token> fields. The record values win on the canonical
  // tokens so the lease always reflects the true tenancy record.
  const recordVars = buildLeaseVars({
    propertyAddress: tenancy.property?.address ?? null,
    tenantName: primary?.name ?? null,
    rent: tenancy.rent_cents != null ? formatRentCents(tenancy.rent_cents) : null,
    deposit:
      tenancy.deposit_cents != null ? formatRentCents(tenancy.deposit_cents) : null,
    startDate: tenancy.start_date,
    endDate: tenancy.end_date,
  });
  const operatorVars = collectVarFields(
    [...formData.entries()].map(([k, v]) => [k, String(v)] as [string, string]),
  );
  const vars = { ...operatorVars, ...recordVars };

  const result = assembleClauses(selected, { leaseType: "residential", vars });
  const snapshot = buildExecutedSnapshot(result);

  const { error } = await supabase.from("lease_documents").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    title: "Residential Lease",
    status: "draft",
    assembled_body: result.text,
    executed_clause_versions: snapshot,
  });
  if (error) redirect(`${back}?lease=error`);

  revalidatePath(back);
  redirect(`${back}?lease=generated`);
}

// Send a generated draft out for signature (lease vault #11, slice 4 — the
// homegrown ECA-2000 rail). FREEZES the rendered lease + its SHA-256 onto the
// row (so what each signer signs can never silently change), inserts a
// lease_signers row per party (landlord + each tenant) with an unguessable
// magic-link token, flips the lease to 'sent', and best-effort emails each
// tenant their /sign link. Guarded on manage_tenancies. Refuses to send a lease
// that still has unfilled {{tokens}} — you shouldn't ask someone to sign a
// half-filled agreement.
export async function sendLeaseForSignature(formData: FormData) {
  await requireCapability("manage_tenancies", "/dashboard/tenancies?forbidden=1");
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const tenancyId = s(formData, "tenancy_id");
  const leaseId = s(formData, "lease_id");
  const back = `/dashboard/tenancies/${tenancyId}`;
  if (!tenancyId || !leaseId) redirect(back);

  const supabase = createClient();

  // The draft to send (RLS scopes to this org; tie it to the tenancy in the URL).
  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select("id, tenancy_id, title, status, assembled_body")
    .eq("id", leaseId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  if (!leaseRow) redirect(`${back}?lease=notfound`);
  const lease = leaseRow as unknown as {
    id: string;
    title: string;
    status: string;
    assembled_body: string | null;
  };
  // Only a draft can be sent (idempotency + no clobbering an in-flight envelope).
  if (lease.status !== "draft") redirect(`${back}?lease=notdraft`);
  // Don't send a lease with values still owed.
  if (lease.assembled_body && tokensInBody(lease.assembled_body).length > 0) {
    redirect(`${back}?lease=incomplete`);
  }

  // The tenancy supplies the structured header (premises / parties / economics),
  // mirrored from the print route so the frozen snapshot renders identically.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, deposit_cents, start_date, end_date, term_months, property:properties(address), tenants(name, email, is_primary, person_id)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tenancyRow) redirect(`${back}?lease=notfound`);
  const tenancy = tenancyRow as unknown as {
    rent_cents: number | null;
    deposit_cents: number | null;
    start_date: string | null;
    end_date: string | null;
    term_months: number | null;
    property: { address: string } | null;
    tenants: {
      name: string | null;
      email: string | null;
      is_primary: boolean;
      person_id: string | null;
    }[];
  };

  // Resolve which person each tenant signer IS, so the executed document files
  // to that person's cross-tenancy vault (the per-person vault primitive). Match
  // a signer to a tenant by normalized email first, then by name.
  const tenantRoster = tenancy.tenants ?? [];
  function personForSigner(name: string | null, email: string | null): string | null {
    const e = normalizeEmail(email);
    if (e) {
      const byEmail = tenantRoster.find((t) => normalizeEmail(t.email) === e);
      if (byEmail?.person_id) return byEmail.person_id;
    }
    const n = (name ?? "").trim().toLowerCase();
    if (n) {
      const byName = tenantRoster.find((t) => (t.name ?? "").trim().toLowerCase() === n);
      if (byName?.person_id) return byName.person_id;
    }
    return null;
  }

  const tenantNames = (tenancy.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((t) => (t.name ?? "").trim())
    .filter((n) => n.length > 0);

  const model: LeaseRenderModel = {
    title: lease.title,
    status: "sent", // frozen as sent — no DRAFT banner on the signing copy
    generatedAtIso: new Date().toISOString(),
    landlordName: org.name,
    propertyAddress: tenancy.property?.address ?? null,
    tenantNames,
    rent: tenancy.rent_cents != null ? formatRentCents(tenancy.rent_cents) : null,
    deposit:
      tenancy.deposit_cents != null ? formatRentCents(tenancy.deposit_cents) : null,
    startDate: tenancy.start_date,
    endDate: tenancy.end_date,
    termMonths: tenancy.term_months,
    clauseBody: lease.assembled_body ?? "",
  };

  // Freeze + hash the EXACT bytes the signer will see (tamper-evidence anchor).
  const documentHash = hashDocument(renderLeaseDocumentHtml(model));

  // Who signs: landlord (org) + each tenant; one token apiece.
  const signers = deriveSigners(org.name, org.reply_to_email, tenancy.tenants ?? []);
  const signerRows = signers.map((sp) => ({
    organization_id: org.id,
    lease_document_id: lease.id,
    role: sp.role,
    name: sp.name,
    email: sp.email,
    sign_order: sp.sign_order,
    token: generateSignToken(),
    status: "pending",
    // file tenant signatures to the cross-tenancy person vault (landlord left null).
    person_id: sp.role === "tenant" ? personForSigner(sp.name, sp.email) : null,
  }));

  const { error: signerErr } = await supabase.from("lease_signers").insert(signerRows);
  if (signerErr) redirect(`${back}?lease=error`);

  const { error: docErr } = await supabase
    .from("lease_documents")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      rendered_snapshot: model,
      document_hash: documentHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lease.id);
  if (docErr) redirect(`${back}?lease=error`);

  // Best-effort email each TENANT their magic link (the landlord is the operator
  // already in-app). Degrades gracefully — operator can also copy links in the UI.
  await Promise.all(
    signerRows
      .filter((r) => r.role === "tenant" && r.email)
      .map((r) =>
        sendLeaseSignatureRequest({
          signer_email: r.email as string,
          signer_name: r.name,
          token: r.token,
          org_name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          reply_to_email: org.reply_to_email,
          property_address: tenancy.property?.address ?? null,
        }),
      ),
  );

  revalidatePath(back);
  redirect(`${back}?lease=sent`);
}

// Withdraw a sent lease back to draft for correction — ONLY while no one has
// signed (after any signature the document is frozen for tamper-evidence, so a
// correction must become a new version + reissue). Deletes the signer rows so
// the outstanding magic-links die. Guarded on manage_tenancies.
export async function withdrawLeaseSignature(formData: FormData) {
  await requireCapability("manage_tenancies", "/dashboard/tenancies?forbidden=1");
  const tenancyId = s(formData, "tenancy_id");
  const leaseId = s(formData, "lease_id");
  const back = `/dashboard/tenancies/${tenancyId}`;
  if (!tenancyId || !leaseId) redirect(back);

  const supabase = createClient();

  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select("id, status")
    .eq("id", leaseId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  if (!leaseRow) redirect(`${back}?lease=notfound`);
  const lease = leaseRow as unknown as { id: string; status: string };

  const { data: signerRows } = await supabase
    .from("lease_signers")
    .select("status")
    .eq("lease_document_id", lease.id);
  const signers = (signerRows ?? []) as { status: string }[];

  // The same rule the UI shows — re-checked here so it can't be bypassed.
  if (!canWithdraw(lease.status, signers)) {
    redirect(`${back}?lease=cannotwithdraw`);
  }

  await supabase.from("lease_signers").delete().eq("lease_document_id", lease.id);
  const { error } = await supabase
    .from("lease_documents")
    .update({
      status: "draft",
      sent_at: null,
      rendered_snapshot: null,
      document_hash: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lease.id);
  if (error) redirect(`${back}?lease=error`);

  revalidatePath(back);
  redirect(`${back}?lease=withdrawn`);
}

// Delete a generated lease draft.
export async function deleteLeaseDocument(formData: FormData) {
  await requireCapability(
    "manage_tenancies",
    "/dashboard/tenancies?forbidden=1",
  );
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "lease_id");
  const back = `/dashboard/tenancies/${tenancyId}`;
  if (!id) redirect(back);

  const supabase = createClient();
  const { error } = await supabase.from("lease_documents").delete().eq("id", id);
  if (error) redirect(`${back}?lease=error`);

  revalidatePath(back);
  redirect(`${back}?lease=deleted`);
}
