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
import { quickOnboardLandlordLeaseFromForm } from "./agent-actions";
import { QUICK_ONBOARD_FIRST_TOUCH_EVENT } from "@/lib/quick-onboard";
import { rentConfirmUrl } from "@/lib/rent-confirm-public";
import Link from "next/link";

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

type AgentSearchParams = {
  quick_onboard?: string;
  reason?: string;
  created_org?: string;
  tenancy?: string;
};

type QuickOnboardReadback = {
  address: string | null;
  confirmUrl: string;
  draftSubject: string | null;
  draftStatus: string | null;
  createdOrg: boolean;
};

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

const QUICK_ONBOARD_ERRORS: Record<string, string> = {
  landlord_name: "Add the landlord name.",
  landlord_email: "Add one valid landlord email.",
  property_address: "Add the rental address.",
  occupancy_date: "Add the lease start date.",
  rent: "Enter rent as a dollar amount, or leave it blank.",
  forbidden: "Your role cannot add rentals and tenancies for that client.",
  org_create: "The client account could not be created.",
  org_update: "The client account could not be updated.",
  property_create: "The rental could not be created.",
  tenancy_create: "The tenancy could not be created.",
  confirm_token: "The tenancy was created, but no rent-confirm link was returned.",
  draft_create: "The first-touch draft could not be queued.",
};

async function loadQuickOnboardReadback(
  supabase: ReturnType<typeof createClient>,
  searchParams: AgentSearchParams,
): Promise<QuickOnboardReadback | null> {
  if (searchParams.quick_onboard !== "ok" || !searchParams.tenancy) return null;
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, confirm_token, property:properties(address)")
    .eq("id", searchParams.tenancy)
    .maybeSingle();
  const token = (tenancy as { confirm_token?: string | null } | null)?.confirm_token;
  if (!token) return null;

  const { data: draft } = await supabase
    .from("pending_tenant_messages")
    .select("subject, status")
    .eq("tenancy_id", searchParams.tenancy)
    .eq("event_key", QUICK_ONBOARD_FIRST_TOUCH_EVENT)
    .maybeSingle();
  const property = one<{ address: string | null }>(
    (tenancy as { property?: { address: string | null } | { address: string | null }[] | null })?.property,
  );
  return {
    address: property?.address ?? null,
    confirmUrl: rentConfirmUrl(token),
    draftSubject: (draft as { subject?: string | null } | null)?.subject ?? null,
    draftStatus: (draft as { status?: string | null } | null)?.status ?? null,
    createdOrg: searchParams.created_org === "1",
  };
}

function QuickOnboardPanel({
  error,
  readback,
}: {
  error: string | null;
  readback: QuickOnboardReadback | null;
}) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Add a lease
          </h2>
        </div>
        <Link
          href="/dashboard/messages"
          className="text-sm font-medium text-brand hover:underline"
        >
          Review drafts
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {readback && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="font-semibold">
            {readback.createdOrg ? "New client added" : "Lease added to existing client"}
            {readback.address ? `: ${readback.address}` : ""}
          </p>
          <p className="mt-1 break-all">
            Rent-confirm link:{" "}
            <a href={readback.confirmUrl} className="font-medium underline">
              {readback.confirmUrl}
            </a>
          </p>
          <p className="mt-1">
            First-touch draft: {readback.draftSubject ?? "queued"}{" "}
            {readback.draftStatus ? `(${readback.draftStatus})` : ""}
          </p>
        </div>
      )}

      <form action={quickOnboardLandlordLeaseFromForm} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">
          Landlord name
          <input
            name="landlord_name"
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="David Harel"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Landlord email
          <input
            name="landlord_email"
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="landlord@example.com"
          />
        </label>
        <label className="text-sm font-medium text-gray-700 md:col-span-2">
          Rental address
          <input
            name="property_address"
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="18 Shorncliffe Ave Unit 3"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Lease start date
          <input
            name="occupancy_date"
            type="date"
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Monthly rent
          <input
            name="rent"
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Leave blank if unknown"
          />
        </label>
        <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 md:col-span-2">
          <input
            name="marketing_consent"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>
            I have consent to contact this landlord about brokerage and real-estate services.
          </span>
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
          >
            Add lease
          </button>
        </div>
      </form>
    </div>
  );
}

export default async function AgentBookPage({
  searchParams = {},
}: {
  searchParams?: AgentSearchParams;
}) {
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
    supabase.from("listing_posts").select("property_id, status, url"),
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

  // Per-property listing-post counts: all statuses are posting history, while
  // status='live' is current outside reach.
  const postCounts = new Map<string, number>();
  const livePostCounts = new Map<string, number>();
  for (const r of (postsRes.data ?? []) as {
    property_id: string | null;
    status: string | null;
    url: string | null;
  }[]) {
    if (!r.property_id) continue;
    postCounts.set(r.property_id, (postCounts.get(r.property_id) ?? 0) + 1);
    if (r.status === "live" && r.url?.trim()) {
      livePostCounts.set(
        r.property_id,
        (livePostCounts.get(r.property_id) ?? 0) + 1,
      );
    }
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
      liveListingPostCount: livePostCounts.get(p.id) ?? 0,
      hasAvailability: orgsWithAvailability.has(p.organization_id),
      leadStatuses: leadStatusesByProp.get(p.id) ?? [],
      tenancyId,
      tenancyStatus: tenancy?.status ?? null,
      needsRentConfirm,
      needsOperatorCount: needsOperatorByProp.get(p.id) ?? 0,
    };
  });

  const rows = buildAgentBookRows({ orgs, units });
  const quickOnboardReadback = await loadQuickOnboardReadback(
    supabase,
    searchParams,
  );
  const quickOnboardError =
    searchParams.quick_onboard === "error"
      ? QUICK_ONBOARD_ERRORS[searchParams.reason ?? ""] ??
        "The lease could not be added."
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-gray-500 transition hover:text-gray-700"
        >
          &larr; Back to dashboard
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">All clients</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every active lease-up across all of your clients, in one place. Sorted
          by which unit needs you most.
        </p>
      </div>
      <QuickOnboardPanel
        error={quickOnboardError}
        readback={quickOnboardReadback}
      />
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
