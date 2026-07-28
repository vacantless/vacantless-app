import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLeadStatus, type LeadStatus } from "@/lib/pipeline";
import { normalizePropertyStatus } from "@/lib/listing-state";
import { leaseTermShiftEnabled } from "@/lib/rent-adjustments-server";
import {
  buildAgentBookRows,
  type AgentBookUnitInput,
} from "@/lib/agent-book";
import { type TenancyLifecycleStatus } from "@/lib/rental-lifecycle";
import { AgentBookTable } from "./agent-book-table";

export const dynamic = "force-dynamic";

// The agent book overview (Tier 1 A). Read-only. Dark behind AGENT_BOOK_ENABLED.
//
// This page deliberately does NOT call getCurrentOrg() — that is single-org by
// design. Instead it reads the org-scoped tables with no org filter and lets RLS
// (organization_id in user_org_ids()) return rows across EVERY org the caller
// belongs to, then groups them in memory. For a single-org user this is exactly
// their one org; for an agent with many client orgs it is their whole book.

type PropertyRow = {
  id: string;
  organization_id: string;
  address: string | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  status: string;
};

const TENANCY_RANK: Record<TenancyLifecycleStatus, number> = {
  active: 3,
  upcoming: 2,
  ended: 1,
};

export default async function AgentBookPage() {
  if (!process.env.AGENT_BOOK_ENABLED) notFound();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");

  const [
    orgsRes,
    propsRes,
    photosRes,
    leadsRes,
    tenanciesRes,
    postsRes,
    availRes,
    runsRes,
    itemsRes,
  ] = await Promise.all([
    supabase.from("organizations").select("id, name"),
    supabase
      .from("properties")
      .select("id, organization_id, address, rent_cents, beds, baths, status")
      .order("created_at", { ascending: false }),
    supabase.from("property_photos").select("property_id"),
    supabase.from("leads").select("property_id, status"),
    supabase
      .from("tenancies")
      .select("id, property_id, status, start_date, created_at"),
    supabase.from("listing_posts").select("property_id"),
    supabase.from("availability_rules").select("organization_id"),
    supabase.from("distribution_runs").select("id, property_id"),
    supabase.from("distribution_run_items").select("run_id, publish_status"),
  ]);

  const orgs = (orgsRes.data ?? []).map((o) => ({
    id: o.id as string,
    name: (o.name as string | null) ?? "Untitled org",
  }));
  const properties = (propsRes.data ?? []) as PropertyRow[];

  // Per-property photo count.
  const photoCounts = new Map<string, number>();
  for (const r of (photosRes.data ?? []) as { property_id: string | null }[]) {
    if (r.property_id)
      photoCounts.set(r.property_id, (photoCounts.get(r.property_id) ?? 0) + 1);
  }

  // Per-property lead statuses.
  const leadStatusesByProp = new Map<string, LeadStatus[]>();
  for (const r of (leadsRes.data ?? []) as {
    property_id: string | null;
    status: string | null;
  }[]) {
    if (!r.property_id || !r.status || !isLeadStatus(r.status)) continue;
    const arr = leadStatusesByProp.get(r.property_id) ?? [];
    arr.push(r.status);
    leadStatusesByProp.set(r.property_id, arr);
  }

  // Per-property listing-post count.
  const postCounts = new Map<string, number>();
  for (const r of (postsRes.data ?? []) as { property_id: string | null }[]) {
    if (r.property_id)
      postCounts.set(r.property_id, (postCounts.get(r.property_id) ?? 0) + 1);
  }

  // Orgs that have at least one weekly viewing window (per-org availability).
  const orgsWithAvailability = new Set<string>();
  for (const r of (availRes.data ?? []) as { organization_id: string | null }[]) {
    if (r.organization_id) orgsWithAvailability.add(r.organization_id);
  }

  // Best tenancy per property: active > upcoming > most recent ended.
  const bestTenancy = new Map<
    string,
    {
      id: string;
      status: TenancyLifecycleStatus;
      startDate: string | null;
      createdAt: string | null;
    }
  >();
  for (const r of (tenanciesRes.data ?? []) as {
    id: string | null;
    property_id: string | null;
    status: string | null;
    start_date: string | null;
    created_at: string | null;
  }[]) {
    if (!r.id || !r.property_id) continue;
    if (r.status !== "active" && r.status !== "upcoming" && r.status !== "ended")
      continue;
    const cand = {
      id: r.id,
      status: r.status as TenancyLifecycleStatus,
      startDate: r.start_date,
      createdAt: r.created_at,
    };
    const cur = bestTenancy.get(r.property_id);
    if (!cur) {
      bestTenancy.set(r.property_id, cand);
      continue;
    }
    if (TENANCY_RANK[cand.status] > TENANCY_RANK[cur.status]) {
      bestTenancy.set(r.property_id, cand);
    } else if (TENANCY_RANK[cand.status] === TENANCY_RANK[cur.status]) {
      // Same rank -> keep the more recent one (by start date, then created_at).
      const a = cand.startDate ?? cand.createdAt ?? "";
      const b = cur.startDate ?? cur.createdAt ?? "";
      if (a > b) bestTenancy.set(r.property_id, cand);
    }
  }

  // needs_operator publish items -> map run -> property -> count.
  const runProperty = new Map<string, string>();
  for (const r of (runsRes.data ?? []) as {
    id: string | null;
    property_id: string | null;
  }[]) {
    if (r.id && r.property_id) runProperty.set(r.id, r.property_id);
  }
  const needsOperatorByProp = new Map<string, number>();
  for (const r of (itemsRes.data ?? []) as {
    run_id: string | null;
    publish_status: string | null;
  }[]) {
    if (r.publish_status !== "needs_operator" || !r.run_id) continue;
    const propertyId = runProperty.get(r.run_id);
    if (!propertyId) continue;
    needsOperatorByProp.set(
      propertyId,
      (needsOperatorByProp.get(propertyId) ?? 0) + 1,
    );
  }

  const rentConfirmEnabled = leaseTermShiftEnabled();
  const confirmedTenancyIds = new Set<string>();
  if (rentConfirmEnabled) {
    const confirmedRes = await supabase
      .from("tenancy_rent_adjustments")
      .select("tenancy_id");
    if (confirmedRes.error) {
      console.error("agent rent-confirm ledger read failed", {
        error: confirmedRes.error.message,
      });
    }
    for (const r of (confirmedRes.data ?? []) as { tenancy_id: string | null }[]) {
      if (r.tenancy_id) confirmedTenancyIds.add(r.tenancy_id);
    }
  }

  const units: AgentBookUnitInput[] = properties.map((p) => {
    const tenancy = bestTenancy.get(p.id) ?? null;
    const tenancyId = tenancy?.id ?? null;
    const needsRentConfirm =
      rentConfirmEnabled &&
      tenancy?.status === "active" &&
      (p.rent_cents ?? 0) > 0 &&
      tenancyId != null &&
      !confirmedTenancyIds.has(tenancyId);
    return {
      orgId: p.organization_id,
      propertyId: p.id,
      address: p.address ?? "Untitled unit",
      unitLabel: null,
      status: normalizePropertyStatus(p.status),
      rentCents: p.rent_cents,
      beds: p.beds,
      baths: p.baths,
      photoCount: photoCounts.get(p.id) ?? 0,
      listingPostCount: postCounts.get(p.id) ?? 0,
      hasAvailability: orgsWithAvailability.has(p.organization_id),
      leadStatuses: leadStatusesByProp.get(p.id) ?? [],
      tenancyId,
      tenancyStatus: tenancy?.status ?? null,
      needsRentConfirm,
      needsOperatorCount: needsOperatorByProp.get(p.id) ?? 0,
    };
  });

  const rows = buildAgentBookRows({ orgs, units });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Agent book</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every active lease-up across all of your clients, in one place. Sorted
          by which unit needs you most.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No units yet. Once you manage units across one or more client accounts,
          they show up here.
        </div>
      ) : (
        <AgentBookTable rows={rows} />
      )}
    </div>
  );
}
