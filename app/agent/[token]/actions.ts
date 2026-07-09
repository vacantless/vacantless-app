"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Public, UNAUTHENTICATED agent self-confirm (showing routing Slice 3). The
// covering agent opens their /agent/[token] shared calendar from the hand-off /
// nudge email; they have NO Vacantless session — the per-agent token in the URL
// is the only handle. Confirming is a POST server action, never a GET side-effect:
// email link scanners (Outlook SafeLinks, Gmail prefetch) fetch GET URLs, so a GET
// that confirmed would auto-confirm on scan (KI585). The write goes through the
// SECURITY DEFINER confirm_showing_from_token RPC, which re-derives the agent +
// org from the token and confirms ONLY a showing actually assigned to that agent.
// The anon client can call it because the function is granted to anon and is the
// source of truth — a wrong token confirms nothing.

function path(token: string, status: string): string {
  return `/agent/${encodeURIComponent(token)}?status=${status}`;
}

export async function confirmShowingFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const showingId = String(formData.get("showing_id") ?? "").trim();
  if (!token || !showingId) redirect("/agent/invalid?status=invalid");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("confirm_showing_from_token", {
    p_agent_token: token,
    p_showing_id: showingId,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    redirect(path(token, result?.reason === "not_found" ? "invalid" : "error"));
  }
  redirect(path(token, "confirmed"));
}
