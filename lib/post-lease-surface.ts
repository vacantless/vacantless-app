import type { createClient } from "@/lib/supabase/server";

// S700: the sellable product is the leasing funnel (DECISION-S697). Repairs,
// Money and Tenants & leases are not finished enough to show a new customer,
// so LEASING_ONLY_NAV=1 walls them off from the nav and the setup checklist.
//
// An org that already uses any of them (Agile) keeps them: the rule is "has
// post-lease data", so nobody loses a screen they rely on. The pages stay
// reachable by URL; this only stops a new customer from wandering into them.
// Flag unset (today's default) changes nothing.

type ServerClient = ReturnType<typeof createClient>;

export function leasingOnlyNavEnabled(): boolean {
  return process.env.LEASING_ONLY_NAV === "1";
}

const POST_LEASE_TABLES = [
  "tenancies",
  "work_orders",
  "expenses",
  "rent_payments",
] as const;

/** True when this org should see Repairs, Money and Tenants & leases. */
export async function orgShowsPostLease(
  supabase: ServerClient,
  orgId: string,
): Promise<boolean> {
  if (!leasingOnlyNavEnabled()) return true;
  const counts = await Promise.all(
    POST_LEASE_TABLES.map((table) =>
      supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
    ),
  );
  // Fail open: if a count errors, show the surface rather than hide real data.
  return counts.some((r) => r.error != null || (r.count ?? 0) > 0);
}
