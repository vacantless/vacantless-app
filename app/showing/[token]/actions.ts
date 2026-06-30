"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Public, UNAUTHENTICATED one-tap showing-outcome recording (post-showing
// outcome-nudge Slice 2). The operator opens this from the nudge email; they
// have NO Vacantless session here — the outcome_token in the URL is the only
// handle. The WRITE is a POST server action, never a GET side-effect: email link
// scanners (Outlook SafeLinks, Gmail prefetch) fetch GET URLs, so a GET that
// recorded an outcome would auto-corrupt data (KI585). The page GET only renders;
// this POST records via the SECURITY DEFINER record_showing_outcome_from_token
// RPC, which re-derives the showing + org from the token server-side and replays
// updateShowingOutcome's effects (set outcome, attended -> lead 'showed', note).
// The anon client can call it because the function is granted to anon and is the
// source of truth — a wrong/garbage token records nothing.

function path(token: string, status: string): string {
  return `/showing/${encodeURIComponent(token)}?status=${status}`;
}

export async function recordOutcomeFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  if (!token) redirect("/showing/invalid?status=invalid");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_showing_outcome_from_token", {
    p_token: token,
    p_outcome: outcome,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    redirect(path(token, result?.reason === "not_found" ? "invalid" : "error"));
  }
  redirect(path(token, "recorded"));
}
