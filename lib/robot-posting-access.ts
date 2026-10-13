// S713: read an org's Posting add-on state and run the one gate
// (lib/billing.ts canUseRobotPosting). Server-only; takes any Supabase client
// (RLS or service role) so every gate site reads it the same way.
//
// FAILS CLOSED. The columns arrive with migration 0244. Until it is applied the
// select errors, and robot posting is refused rather than given away. Apply
// 0244 before deploying this code, or Agile's robot posting pauses.
//
// Kept out of lib/org.ts ORG_COLUMNS on purpose: adding an unmigrated column
// there would break every dashboard page, not just posting.

import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseRobotPosting } from "@/lib/billing";

export type RobotPostingAccess = {
  allowed: boolean;
  plan: string | null;
  addonActive: boolean;
  addonItemId: string | null;
};

const CLOSED: RobotPostingAccess = {
  allowed: false,
  plan: null,
  addonActive: false,
  addonItemId: null,
};

export async function readRobotPostingAccess(
  client: SupabaseClient,
  orgId: string | null | undefined,
): Promise<RobotPostingAccess> {
  if (!orgId) return CLOSED;
  try {
    const { data, error } = await client
      .from("organizations")
      .select("plan, posting_addon_active, posting_addon_subscription_item_id")
      .eq("id", orgId)
      .maybeSingle();
    if (error || !data) return CLOSED;
    const row = data as {
      plan: string | null;
      posting_addon_active: boolean | null;
      posting_addon_subscription_item_id: string | null;
    };
    return {
      allowed: canUseRobotPosting(row),
      plan: row.plan ?? null,
      addonActive: row.posting_addon_active === true,
      addonItemId: row.posting_addon_subscription_item_id ?? null,
    };
  } catch {
    return CLOSED;
  }
}
