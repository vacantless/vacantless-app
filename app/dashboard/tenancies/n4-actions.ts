"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import {
  buildN4Snapshot,
  n4SnapshotBlocker,
  snapshotToN4Fill,
  type N4Snapshot,
} from "@/lib/n4-snapshot";
import { fillOfficialN4, N4_TEMPLATE_VERSION } from "@/lib/n4-official-pdf";
import { parseAmountToCents, parseDateOrNull, type PaymentRow } from "@/lib/payments";
import { documentStoragePath } from "@/lib/documents";
import { DOCUMENTS_BUCKET } from "@/lib/documents-server";

// N4 (arrears termination) operator flow — Slice C of the N-form library
// (N-FORM-LIBRARY-DESIGN-2026-07-12.md). PREPARE-FIRST: the app derives + freezes
// the operator's reviewed figures into an immutable notices.snapshot and produces
// the official Board-approved Form N4 for the OPERATOR to serve themselves. There
// is NO serve-on-behalf here — serve-on-behalf stays gated behind the per-form
// legal-verify pass (design section 6).
//
// SECURITY (KI744/748): every write authorizes against, and stamps
// organization_id from, the RESOURCE's own org (the tenancy / the notice row read
// under RLS) — never getCurrentOrg(). manage_tenancies gates every action.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

const anchor = (id: string, q: string) =>
  `/dashboard/tenancies/${id}?n4=${q}#notices`;

function todayOntario(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

// ---------------------------------------------------------------------------
// Prepare an N4: derive arrears from the rent + payment ledger, freeze the
// reviewed snapshot, and create a DRAFT notice. Blocks (no serve) when the
// ledger can't produce a valid, non-overstated N4.
// ---------------------------------------------------------------------------
export async function prepareN4(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const noticeDateISO = parseDateOrNull(s(formData, "notice_date")) ?? todayOntario();
  const overrideOwingCents = parseAmountToCents(s(formData, "override_owing")); // null if blank

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Read the tenancy + its OWN org under RLS. Every id + the org we stamp comes
  // from this resource read, never a client value or getCurrentOrg().
  const { data: tRow } = await supabase
    .from("tenancies")
    .select(
      "id, organization_id, status, rent_cents, start_date, " +
        "property:properties(address), " +
        "tenants(name, is_primary), " +
        "organization:organizations(name, public_contact_phone)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");

  const t = tRow as unknown as {
    id: string;
    organization_id: string;
    status: string;
    rent_cents: number | null;
    start_date: string | null;
    property: { address: string | null } | null;
    tenants: { name: string | null; is_primary: boolean }[];
    organization: { name: string | null; public_contact_phone: string | null } | null;
  };

  if (t.status !== "active" || t.rent_cents == null || !t.start_date) {
    redirect(anchor(tenancyId, "notready"));
  }

  const { data: payRows } = await supabase
    .from("rent_payments")
    .select("amount_cents, period_month")
    .eq("tenancy_id", tenancyId);
  const payments: PaymentRow[] = (payRows ?? []).map((p) => {
    const r = p as { amount_cents: number; period_month: string | null };
    return { amount_cents: r.amount_cents, period_month: r.period_month };
  });

  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter((n) => n.length > 0);

  const snapshot: N4Snapshot = buildN4Snapshot({
    landlordName: t.organization?.name ?? "",
    landlordPhone: t.organization?.public_contact_phone ?? null,
    rentalUnitAddress: t.property?.address?.trim() || null,
    tenantNames,
    rentCents: t.rent_cents as number,
    startDateISO: t.start_date as string,
    noticeDateISO,
    payments,
    overrideOwingCents,
    formVersion: N4_TEMPLATE_VERSION,
    capturedAtIso: new Date().toISOString(),
  });

  // Fail-closed: never persist a notice the ledger can't back (overstated /
  // unresolved credits / no arrears). The operator resolves payments or sets an
  // override, then re-prepares.
  const blocker = n4SnapshotBlocker(snapshot);
  if (blocker) redirect(anchor(tenancyId, blocker));

  const { error } = await supabase.from("notices").insert({
    organization_id: t.organization_id, // resource org (KI748)
    tenancy_id: tenancyId,
    type: "N4",
    status: "draft",
    snapshot,
    termination_date: snapshot.terminationDateISO,
    total_owing_cents: snapshot.totalOwingCents,
    created_by: user?.id ?? null,
  });
  if (error) redirect(anchor(tenancyId, "error"));

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "prepared"));
}

// ---------------------------------------------------------------------------
// Record that the operator served a prepared N4 themselves (hand / mail /
// courier). Lights up the public /notice/[token] view for the tenant.
// ---------------------------------------------------------------------------
export async function recordN4Service(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const noticeId = s(formData, "notice_id");
  const method = s(formData, "method");
  if (!noticeId) redirect(anchor(tenancyId, "error"));
  // v1 supports IN-PERSON (hand) service only: termination = notice date + the
  // minimum notice days, no deemed-service add-on. Mail/courier shift the deemed
  // service date (and thus the termination date) and are deferred to the per-form
  // legal-verify gate (design section 6) - so we never record a mail/courier N4
  // whose frozen PDF used hand-service timing.
  if (method !== "hand") {
    redirect(anchor(tenancyId, "badmethod"));
  }

  const supabase = createClient();
  // RLS scopes to the caller's org; also pin to this tenancy + a draft N4.
  const { data: n } = await supabase
    .from("notices")
    .select("id, status, type")
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  const notice = n as { id: string; status: string; type: string } | null;
  if (!notice || notice.type !== "N4") redirect(anchor(tenancyId, "error"));
  if (notice.status !== "draft") redirect(anchor(tenancyId, "notdraft"));

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notices")
    .update({
      status: "served",
      served_at: nowIso,
      served_method: method,
      updated_at: nowIso,
    })
    .eq("id", noticeId)
    .eq("status", "draft"); // idempotent: only a draft flips to served
  if (error) redirect(anchor(tenancyId, "error"));

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "served"));
}

// ---------------------------------------------------------------------------
// File the official served N4 PDF into the document vault (source=
// in_app_generated). Idempotent. Must be served first (the vault copy is the
// operator's record of the served notice).
// ---------------------------------------------------------------------------
export async function fileN4ToVault(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const noticeId = s(formData, "notice_id");
  if (!noticeId) redirect(anchor(tenancyId, "error"));

  const supabase = createClient();
  const { data: n } = await supabase
    .from("notices")
    .select("id, organization_id, type, status, snapshot, filed_document_id")
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  const notice = n as {
    id: string;
    organization_id: string;
    type: string;
    status: string;
    snapshot: N4Snapshot | null;
    filed_document_id: string | null;
  } | null;
  if (!notice || notice.type !== "N4" || !notice.snapshot) {
    redirect(anchor(tenancyId, "error"));
  }
  const safeNotice = notice as NonNullable<typeof notice>;
  if (safeNotice.filed_document_id) redirect(anchor(tenancyId, "filed")); // idempotent
  if (safeNotice.status !== "served" && safeNotice.status !== "filed") {
    redirect(anchor(tenancyId, "notserved"));
  }

  const snap = safeNotice.snapshot as N4Snapshot;
  const docId = crypto.randomUUID();
  const nowReserve = new Date().toISOString();

  // RESERVE the filing slot BEFORE any side effect (S479 reserve-before-side-
  // effects model): atomically claim filed_document_id iff still null. A
  // concurrent double-submit loses this CAS (0 rows) and does NO upload/insert,
  // so exactly one vault document is ever created.
  const { data: claimed } = await supabase
    .from("notices")
    .update({ filed_document_id: docId, updated_at: nowReserve })
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .eq("type", "N4")
    .in("status", ["served", "filed"])
    .is("filed_document_id", null)
    .select("id");
  if (!claimed || claimed.length === 0) redirect(anchor(tenancyId, "filed"));

  // We own the slot. Roll the reservation back if the artifact can't be created.
  const unreserve = async () => {
    await supabase
      .from("notices")
      .update({ filed_document_id: null })
      .eq("id", noticeId)
      .eq("filed_document_id", docId);
  };

  let buf: Buffer;
  try {
    const bytes = await fillOfficialN4(snapshotToN4Fill(snap));
    buf = Buffer.from(bytes);
  } catch {
    await unreserve();
    redirect(anchor(tenancyId, "failed"));
  }

  const path = documentStoragePath(safeNotice.organization_id, docId, "pdf");
  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, buf, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    await unreserve();
    redirect(anchor(tenancyId, "failed"));
  }

  let sha256: string | null = null;
  try {
    sha256 = createHash("sha256").update(buf).digest("hex");
  } catch {
    sha256 = null;
  }

  const title = `Form N4 — ${snap.rentalUnitAddress?.trim() || "Notice"} (${snap.noticeDateISO})`;
  const { error: insErr } = await supabase.from("documents").insert({
    id: docId,
    organization_id: safeNotice.organization_id, // resource org (KI748)
    tenancy_id: tenancyId,
    title,
    doc_type: "notice",
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: buf.length,
    sha256,
    source: "in_app_generated",
  });
  if (insErr) {
    const { error: rbErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([path]);
    if (rbErr) {
      console.error("fileN4ToVault: rollback remove failed", { path, error: rbErr.message });
    }
    await unreserve();
    redirect(anchor(tenancyId, "failed"));
  }

  // filed_document_id was already claimed in the reservation above; finalize the
  // status. Scoped to the slot WE own (filed_document_id == our docId).
  const nowIso = new Date().toISOString();
  await supabase
    .from("notices")
    .update({ status: "filed", updated_at: nowIso })
    .eq("id", noticeId)
    .eq("filed_document_id", docId);

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "filed"));
}

// ---------------------------------------------------------------------------
// Void a prepared/served N4 (e.g. paid in full, or an error). Keeps the row for
// the audit trail; the public view stops rendering (status no longer served).
// ---------------------------------------------------------------------------
export async function voidN4(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const noticeId = s(formData, "notice_id");
  if (!noticeId) redirect(anchor(tenancyId, "error"));

  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notices")
    .update({ status: "void", updated_at: nowIso })
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .eq("type", "N4");
  if (error) redirect(anchor(tenancyId, "error"));

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "voided"));
}
