// Impure orchestration for the referral loop (S355, Slice 2) — the accept-flip.
//
// SERVER-ONLY. The accept-flip runs the moment a referred friend finishes
// signup, when the authed session is the FRIEND, not the referrer. RLS only
// lets the referrer read/insert their own referral rows (there is deliberately
// no friend-facing UPDATE policy), so the flip uses the SERVICE-ROLE admin
// client (bypasses RLS). It is BEST-EFFORT: any miss is a silent skip — the
// friend's signup must always complete (same posture as the onboarding seeds).
//
// The authed INSERT of a pending referral row lives in the page's actions.ts
// (it runs as the referrer, so RLS org_invites_insert_referral covers it).

import { createAdminClient } from "@/lib/supabase/admin";
import { canAcceptReferral, parseRefToken, type AcceptCandidateRow } from "@/lib/referrals";

export type AcceptReferralResult =
  | { accepted: true; inviteId: string }
  | { accepted: false; reason: string };

/**
 * Attribute a freshly-created org to its referral, if the signup carried a valid
 * ?ref token. Fetches the pending row by token (service-role), applies the pure
 * canAcceptReferral guards, and flips it pending -> accepted with the friend's
 * new org/user. Never throws; returns an outcome only for server logs.
 */
export async function acceptReferral(
  rawToken: string | null | undefined,
  newOrgId: string,
  newUserId: string,
): Promise<AcceptReferralResult> {
  const token = parseRefToken(rawToken);
  if (!token) return { accepted: false, reason: "no_token" };

  const admin = createAdminClient();
  if (!admin) return { accepted: false, reason: "not_configured" };

  try {
    const { data: row } = await admin
      .from("org_invites")
      .select("id, status, source, referred_by_org_id")
      .eq("token", token)
      .limit(1)
      .maybeSingle();

    const candidate: AcceptCandidateRow = row
      ? {
          status: (row as { status: string }).status,
          source: (row as { source: string }).source,
          referred_by_org_id: (row as { referred_by_org_id: string | null })
            .referred_by_org_id,
        }
      : null;

    const decision = canAcceptReferral(candidate, newOrgId);
    if (!decision.accept) return { accepted: false, reason: decision.reason };

    const inviteId = (row as { id: string }).id;
    // Guard the UPDATE with status='pending' too, so a race (two near-simultaneous
    // accepts of the same token) only lets the first one win.
    const { data: updated, error } = await admin
      .from("org_invites")
      .update({
        status: "accepted",
        provisioned_org_id: newOrgId,
        provisioned_user_id: newUserId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", inviteId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error || !updated) return { accepted: false, reason: "update_failed" };
    return { accepted: true, inviteId };
  } catch {
    return { accepted: false, reason: "exception" };
  }
}
