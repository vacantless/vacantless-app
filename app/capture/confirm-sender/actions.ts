"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isValidSenderConfirmToken,
  hashSenderConfirmToken,
  isSenderConfirmExpired,
} from "@/lib/email-ingest";

// ============================================================================
// Public sender-confirmation action (capture ingress F4, S379). The person
// clicking the emailed link has NO Vacantless session — the single-use token IS
// the proof they control the address. We look the pending sender up by
// sha256(token), confirm it is not expired or already verified, then set
// verified_at and clear the token (single-use). Uses the service-role admin
// client because an anonymous caller cannot satisfy RLS; the action only ever
// flips the ONE row whose token hash matches, and reveals nothing about any other
// org or sender. Runs on POST only (the page renders a button) so an email
// scanner that merely GETs the link cannot auto-confirm it.
// ============================================================================

const BASE = "/capture/confirm-sender";

export async function confirmSenderAddress(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!isValidSenderConfirmToken(token)) redirect(`${BASE}?status=invalid`);

  const admin = createAdminClient();
  if (!admin) redirect(`${BASE}?status=error`);

  const { data: row } = await admin
    .from("org_ingest_senders")
    .select("id, verified_at, confirm_sent_at")
    .eq("confirm_token_sha256", hashSenderConfirmToken(token))
    .maybeSingle();
  if (!row) redirect(`${BASE}?status=invalid`); // unknown / already-cleared token
  if (row.verified_at) redirect(`${BASE}?status=already`);
  if (isSenderConfirmExpired(row.confirm_sent_at)) redirect(`${BASE}?status=expired`);

  const { error } = await admin
    .from("org_ingest_senders")
    .update({ verified_at: new Date().toISOString(), confirm_token_sha256: null })
    .eq("id", row.id)
    .is("verified_at", null); // idempotent: a concurrent confirm wins once
  if (error) redirect(`${BASE}?status=error`);

  redirect(`${BASE}?status=confirmed`);
}
