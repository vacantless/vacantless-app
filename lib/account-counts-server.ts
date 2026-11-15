import type { SupabaseClient } from "@supabase/supabase-js";
import { describeSource, parseSourceValue } from "@/lib/signup-source";
import { QUIET_NOTIFICATION_ORGANIZATION_IDS } from "@/lib/quiet-orgs";
import { isOwnTestAccount, type AccountCounts } from "@/lib/new-account-watch";

// S800: one loader for "outside accounts made since X and how far each got",
// shared by the daily new-account email (S702) and the admin funnel (S800).
// Leaves out the quiet orgs and every account whose logins are all ours.
export async function loadOutsideAccounts(
  admin: SupabaseClient,
  sinceIso: string,
): Promise<{ accounts: AccountCounts[]; excluded: Set<string>; error: string | null }> {
  const excluded = new Set<string>(QUIET_NOTIFICATION_ORGANIZATION_IDS);
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, plan, subscription_status, created_at, closed_at, signup_source, first_live_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  if (error) return { accounts: [], excluded, error: `orgs:${error.message}` };

  const count = async (table: string, orgId: string, notDraft = false) => {
    let q = admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (notDraft) q = q.neq("status", "draft");
    const { count: c } = await q;
    return c ?? 0;
  };

  const memberEmails = async (orgId: string): Promise<string[]> => {
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", orgId);
    const emails: string[] = [];
    for (const m of members ?? []) {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      emails.push(data?.user?.email ?? "");
    }
    return emails;
  };

  const accounts: AccountCounts[] = [];
  for (const o of orgs ?? []) {
    if (excluded.has(o.id)) continue;
    if (isOwnTestAccount(await memberEmails(o.id))) {
      excluded.add(o.id);
      continue;
    }
    const [rentals, liveRentals, rules, overrides, enquiries, bookings] = await Promise.all([
      count("properties", o.id),
      count("properties", o.id, true),
      count("availability_rules", o.id),
      count("availability_overrides", o.id),
      count("leads", o.id),
      count("showings", o.id),
    ]);
    accounts.push({
      id: o.id,
      name: o.name,
      createdAt: o.created_at,
      plan: o.plan,
      subscriptionStatus: o.subscription_status,
      closedAt: o.closed_at,
      rentals,
      liveRentals,
      viewingTimes: rules + overrides,
      enquiries,
      bookings,
      source: describeSource(parseSourceValue(o.signup_source)),
      firstLiveAt: o.first_live_at ?? null,
    });
  }
  return { accounts, excluded, error: null };
}
