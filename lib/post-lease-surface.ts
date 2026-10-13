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

export function leasingOnlyNavEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.LEASING_ONLY_NAV === "1";
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

// S710: leasing-only orgs see only renter, viewing and ad screens. The nav
// wall alone left the post-lease pages open by URL; each post-lease section
// (tenancies, tenants, money, rent, expenses, maintenance) now has a
// layout.tsx that calls this guard, so a typed URL goes back to Today.
// Route handlers (CSV/PDF exports) are not wrapped by layouts; they stay
// reachable, but a walled org has no post-lease rows for them to export.
export const POST_LEASE_SECTIONS = [
  "tenancies",
  "tenants",
  "money",
  "rent",
  "expenses",
  "maintenance",
] as const;

/** Server-only guard for a post-lease section layout. Redirects when walled. */
export async function requirePostLeaseSurface(): Promise<void> {
  if (!leasingOnlyNavEnabled()) return;
  const [{ createClient }, { getCurrentOrg }, { redirect }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/org"),
    import("next/navigation"),
  ]);
  const org = await getCurrentOrg();
  // No org: the dashboard layout already sends the user to onboarding.
  if (!org) return;
  const show = await orgShowsPostLease(createClient(), org.id);
  if (!show) redirect("/dashboard");
}
