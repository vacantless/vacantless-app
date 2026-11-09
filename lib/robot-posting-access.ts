// S713: read an org's Posting add-on state and run the one gate
// (lib/billing.ts canUseRobotPosting). Server-only; takes any Supabase client
// (RLS or service role) so every gate site reads it the same way.
//
// FAILS CLOSED. The columns arrive with migration 0244 (0273 adds the
// standing setting, read separately so it can land either side of a deploy). Until it is applied the
// select errors, and robot posting is refused rather than given away. Apply
// 0244 before deploying this code, or Agile's robot posting pauses.
//
// Kept out of lib/org.ts ORG_COLUMNS on purpose: adding an unmigrated column
// there would break every dashboard page, not just posting.

import type { SupabaseClient } from "@supabase/supabase-js";
import { canSetUpRobotSites, canUseRobotPosting, robotPostingAllowedFor } from "@/lib/billing";

export type RobotPostingAccess = {
  /**
   * The robot may post. With a rental (opts.rental) this is per rental: the
   * add-on, or Free and no other live rental (S767, item F). Without one it
   * is the add-on alone.
   */
  allowed: boolean;
  /** S767: allowed only because this is the Free account's one live rental. */
  freeRental: boolean;
  /** S767: the account may sign in to the robot sites (the add-on, or Free). */
  setup: boolean;
  plan: string | null;
  addonActive: boolean;
  addonItemId: string | null;
  /** S754: post prepared free ads without a per-ad approval (migration 0273). */
  autopilot: boolean;
};

const CLOSED: RobotPostingAccess = {
  allowed: false,
  freeRental: false,
  setup: false,
  plan: null,
  addonActive: false,
  addonItemId: null,
  autopilot: false,
};

export async function readRobotPostingAccess(
  client: SupabaseClient,
  orgId: string | null | undefined,
  opts?: {
    /** The rental the robot would post: its id, or "new" for one not saved yet. */
    rental?: string | null;
  },
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
    // S754: the standing setting is read on its own, so a build deployed
    // before migration 0273 keeps robot posting (the setting just reads off).
    let autopilot = false;
    try {
      const { data: auto } = await client
        .from("organizations")
        .select("posting_autopilot")
        .eq("id", orgId)
        .maybeSingle();
      autopilot = (auto as { posting_autopilot: boolean | null } | null)?.posting_autopilot === true;
    } catch {
      autopilot = false;
    }
    const addon = canUseRobotPosting(row);
    // S767: a Free account's one live rental. Count the OTHER live rentals in
    // this account; any read error leaves it closed.
    let allowed = addon;
    let freeRental = false;
    if (!addon && opts?.rental && canSetUpRobotSites(row)) {
      let q = client
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "available")
        .is("archived_at", null);
      if (opts.rental !== "new") q = q.neq("id", opts.rental);
      const { count, error: countErr } = await q;
      if (!countErr && count != null) {
        allowed = robotPostingAllowedFor(row, { otherLiveRentals: count });
        freeRental = allowed;
      }
    }
    return {
      allowed,
      freeRental,
      setup: canSetUpRobotSites(row),
      plan: row.plan ?? null,
      addonActive: row.posting_addon_active === true,
      addonItemId: row.posting_addon_subscription_item_id ?? null,
      autopilot,
    };
  } catch {
    return CLOSED;
  }
}
