"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRenewalIntent } from "@/lib/renewal";

// Public, UNAUTHENTICATED tenant renewal check-in (autopilot Slice A, S460). The
// tenant opens /renewal/[token] from the landlord's ask; they have NO Vacantless
// session — the per-tenancy renewal_intent_token in the URL is the only handle.
// Recording is a POST server action, never a GET side-effect: email link
// scanners (Outlook SafeLinks, Gmail prefetch) fetch GET URLs, so a GET that
// recorded would auto-answer on scan (KI585). The write goes through the
// SECURITY DEFINER record_renewal_intent RPC (0131), which resolves the tenancy
// from the token server-side and stores ONLY the enum choice — no PII, no table
// grant to anon. A wrong token records nothing.

function path(token: string, status: string): string {
  return `/renewal/${encodeURIComponent(token)}?status=${status}`;
}

export async function recordRenewalIntent(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const choice = String(formData.get("choice") ?? "").trim();
  if (!token) redirect("/renewal/invalid?status=invalid");
  // Only the three real answers; anything else bounces without a DB call.
  if (!isRenewalIntent(choice)) redirect(path(token, "error"));

  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_renewal_intent", {
    p_token: token,
    p_choice: choice,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    redirect(path(token, result?.reason === "not_found" ? "invalid" : "error"));
  }
  redirect(path(token, `recorded_${choice}`));
}
