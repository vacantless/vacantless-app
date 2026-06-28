"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { canUseCaptureEmailIn } from "@/lib/billing";
import { generateIngestToken, normalizeIngestSender } from "@/lib/email-ingest";
import { normalizePendingDocId } from "@/lib/asset-capture";
import { retentionUntil } from "@/lib/document-retention";
import { DOCUMENTS_BUCKET } from "@/lib/documents-server";

// ============================================================================
// Capture Phase 3, Slice 2 — provisioning actions for the email-in capture
// address + the per-org verified-sender allow-list.
//
// TIER-GATED (S368): email-in capture is Growth+ (canUseCaptureEmailIn). The gate
// is enforced HERE (the provisioning action), not just hidden in the UI, so a
// Free org cannot mint an address by posting the form directly. The inbound
// webhook itself stays org-scoped regardless of plan — the gate is on PROVISIONING.
//
// These run as the authenticated operator (RLS server client); the 0086 RLS
// policies scope every read/write to the caller's org. manage_settings is the
// capability (provisioning an org address is a settings-level act).
// ============================================================================

const BASE = "/dashboard/captures";

async function gateEmailCapture() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_settings", `${BASE}?forbidden=1`);
  if (!canUseCaptureEmailIn(org.plan)) redirect(`${BASE}?locked=1`);
  return org;
}

/** Mint the org's active email-in address if it doesn't have one. Idempotent:
 * the 0086 partial-unique (one active per org+channel) makes a double-submit a
 * no-op rather than a second address. */
export async function provisionIngestAddress() {
  const org = await gateEmailCapture();
  const supabase = createClient();

  const { data: existing } = await supabase
    .from("org_ingest_addresses")
    .select("id")
    .eq("organization_id", org.id)
    .eq("channel", "email")
    .eq("active", true)
    .maybeSingle();
  if (existing?.id) redirect(`${BASE}?provisioned=already`);

  const { error } = await supabase.from("org_ingest_addresses").insert({
    organization_id: org.id,
    channel: "email",
    token: generateIngestToken(),
    active: true,
  });
  if (error) redirect(`${BASE}?error=provision`);

  revalidatePath(BASE);
  redirect(`${BASE}?provisioned=1`);
}

/** Rotate the address: deactivate the current active one (kept for audit) and
 * mint a fresh token. Used if an address leaks or gets spammed. */
export async function rotateIngestAddress() {
  const org = await gateEmailCapture();
  const supabase = createClient();

  await supabase
    .from("org_ingest_addresses")
    .update({ active: false, rotated_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("channel", "email")
    .eq("active", true);

  const { error } = await supabase.from("org_ingest_addresses").insert({
    organization_id: org.id,
    channel: "email",
    token: generateIngestToken(),
    active: true,
  });
  if (error) redirect(`${BASE}?error=rotate`);

  revalidatePath(BASE);
  redirect(`${BASE}?rotated=1`);
}

/** Add a verified sender to the allow-list. The address is normalized the SAME
 * way the webhook normalizes an inbound From (so they compare equal). v1 trusts
 * the operator's assertion that this is their own forwarding address, so it is
 * verified immediately (verified_at = now); a future slice can add an email
 * round-trip confirm. on-conflict-do-nothing keeps it idempotent. */
export async function addIngestSender(formData: FormData) {
  const org = await gateEmailCapture();
  const raw = String(formData.get("address") ?? "");
  const address = normalizeIngestSender("email", raw);
  if (!address) redirect(`${BASE}?sender=invalid`);

  const supabase = createClient();
  const { error } = await supabase
    .from("org_ingest_senders")
    .upsert(
      {
        organization_id: org.id,
        channel: "email",
        address,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,channel,address", ignoreDuplicates: true },
    );
  if (error) redirect(`${BASE}?sender=error`);

  revalidatePath(BASE);
  redirect(`${BASE}?sender=added`);
}

/** Remove a verified sender. RLS scopes the delete to the caller's org; the id
 * targets one row. A no-longer-trusted sender's future mail then quarantines. */
export async function removeIngestSender(formData: FormData) {
  await gateEmailCapture();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect(`${BASE}?sender=error`);

  const supabase = createClient();
  const { error } = await supabase.from("org_ingest_senders").delete().eq("id", id);
  if (error) redirect(`${BASE}?sender=error`);

  revalidatePath(BASE);
  redirect(`${BASE}?sender=removed`);
}

/** Discard an inbound capture from the review queue: remove the stored bytes and
 * soft-delete the row (so it leaves the queue and the retention purge finishes
 * it). Guarded to a pending, unlinked, ingress capture in the caller's org (RLS
 * scopes the read/write; the filters make a stale/forged id a no-op). */
export async function discardCapture(formData: FormData) {
  const org = await gateEmailCapture();
  const docId = normalizePendingDocId(formData.get("doc_id"));
  if (!docId) redirect(`${BASE}?review=error`);

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, source, appliance_id, expense_id")
    .eq("id", docId)
    .eq("organization_id", org.id)
    .not("pending_until", "is", null)
    .is("appliance_id", null)
    .is("expense_id", null)
    .maybeSingle();
  if (!doc) redirect(`${BASE}?review=gone`); // already confirmed/discarded/reaped

  // Free the bytes now (best-effort), then soft-delete so the row leaves every
  // list query and the document-retention purge finishes it.
  if (doc.storage_path) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
  }
  const nowIso = new Date().toISOString();
  await supabase
    .from("documents")
    .update({ deleted_at: nowIso, retention_until: retentionUntil(nowIso), pending_until: null })
    .eq("id", docId)
    .eq("organization_id", org.id);

  revalidatePath(BASE);
  redirect(`${BASE}?review=discarded`);
}
