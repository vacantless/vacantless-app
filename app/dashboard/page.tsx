import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PIPELINE_STAGES,
  statusLabel,
  needsReply,
  type LeadStatus,
} from "@/lib/pipeline";
import {
  buildLaunchChecklist,
  isReplyToConfigured,
} from "@/lib/onboarding";
import { isSubscriptionActive, pilotStatus } from "@/lib/billing";
import {
  SectionHeading,
  EmptyState,
  StatusChip,
  StatCard,
  BrandBanner,
  leadStatusTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { LaunchChecklist } from "./launch-checklist";
import { deriveRentIncrease } from "@/lib/rent-increase";
import { RentIncreaseRow } from "@/components/rent-increase-card";
import { buildTodayLane } from "@/lib/dashboard-today";
import { TodayLane } from "./today-lane";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  status: LeadStatus;
  created_at: string;
  property_id: string | null;
  qualified_out: boolean;
  property: { address: string } | null;
};

const OPEN_STATUSES: LeadStatus[] = [
  "new",
  "replied",
  "contacted",
  "booked",
  "showed",
  "applied",
];

export default async function OverviewPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();
  const timeZone = org?.booking_timezone ?? "America/Toronto";

  // RLS scopes all of these to the caller's org automatically.
  const [
    { data: leads },
    { count: propertyCount },
    { count: availabilityCount },
    { data: showingData },
    { data: tenancyRows },
    { data: availablePropertyRows },
    { data: workOrderRows },
    { count: pendingMessageCount },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, name, email, source, status, created_at, property_id, qualified_out, property:properties(address)",
      )
      .order("created_at", { ascending: false }),
    // Total property count — drives the "Add your first rental" checklist step.
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("availability_rules")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("showings")
      .select(
        "id, scheduled_at, outcome, lead:leads(id, name, email), property:properties(address)",
      )
      .eq("outcome", "scheduled")
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(5),
    // Active tenancies — feed the rent-increase rollup (N1 v1, S282). Renders
    // only when something is actionable, so a pure-leasing org never sees it
    // (conditional-visibility rule, like the Money nav).
    supabase
      .from("tenancies")
      .select("id, status, rent_cents, start_date, property:properties(address)")
      .eq("status", "active"),
    // Most-recent AVAILABLE property — deep-links the "Test your renter inquiry
    // page" checklist step to a public /r page that actually renders. The public
    // page 404s on draft/off-market (get_public_listing excludes them), so
    // linking the newest property of ANY status could point the step at a draft
    // (the S294 preview-broken bug). Null when nothing is live yet → the step
    // falls back to the Properties list.
    supabase
      .from("properties")
      .select("id")
      .eq("status", "available")
      .order("created_at", { ascending: false })
      .limit(1),
    // Active maintenance work orders — feed the Overview "needs attention" tile
    // (work-order module Slice 3). Only open/assigned/in_progress jobs; renders
    // only when something is active (conditional-visibility rule).
    supabase
      .from("work_orders")
      .select("id, status, priority")
      .in("status", ["open", "assigned", "in_progress"]),
    // Pending tenant-message drafts awaiting approval (approve-to-send drip,
    // S341). Drives a conditional Overview rollup → /dashboard/messages. Renders
    // only when something is waiting (conditional-visibility rule), so the whole
    // approval-gated drip stays invisible until a draft exists.
    supabase
      .from("pending_tenant_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  // Open + urgent work-order counts for the Overview tile.
  const activeWorkOrders = (workOrderRows ?? []) as {
    id: string;
    status: string;
    priority: string;
  }[];
  const urgentWorkOrders = activeWorkOrders.filter((w) => w.priority === "urgent");

  const upcomingShowings = (showingData ?? []) as unknown as {
    id: string;
    scheduled_at: string | null;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: { address: string } | null;
  }[];

  // PostgREST types the embedded `property` as an array; it's a to-one relation
  // so the runtime value is a single object (or null). Cast through unknown,
  // matching the upcomingShowings projection above.
  const allLeads = (leads ?? []) as unknown as LeadRow[];
  const openLeads = allLeads.filter((l) => OPEN_STATUSES.includes(l.status));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = allLeads.filter(
    (l) => new Date(l.created_at).getTime() >= weekAgo,
  );

  const counts: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) counts[stage] = 0;
  for (const l of allLeads) counts[l.status] = (counts[l.status] ?? 0) + 1;

  // Rent-increase rollup (N1 v1, S282): the only actionable statuses surface
  // here, most-urgent first. "Today" uses the org's timezone (Ontario default).
  type TenancyRow = {
    id: string;
    rent_cents: number | null;
    start_date: string | null;
    property: { address: string } | null;
  };
  const today = new Date().toLocaleDateString("en-CA", { timeZone });
  const URGENCY: Record<string, number> = {
    overdue: 0,
    serve_late: 1,
    serve_window: 2,
  };
  const rentIncreaseAlerts = ((tenancyRows ?? []) as unknown as TenancyRow[])
    .flatMap((t) => {
      if (t.rent_cents == null || !t.start_date) return [];
      const result = deriveRentIncrease(
        { startDate: t.start_date, currentRentCents: t.rent_cents },
        today,
      );
      if (!result || !(result.status in URGENCY)) return [];
      return [{ id: t.id, label: t.property?.address ?? "Tenancy", result }];
    })
    .sort(
      (a, b) =>
        URGENCY[a.result.status] - URGENCY[b.result.status] ||
        a.result.earliestEffectiveDate.localeCompare(
          b.result.earliestEffectiveDate,
        ),
    );

  // "Today" action lane (Codex design audit #3): an action-first summary above
  // the stats, built from counts already derived here. Conditional-visibility —
  // only nonzero signals appear; an empty lane renders an "all caught up" state.
  const viewingsToday = upcomingShowings.filter(
    (s) =>
      s.scheduled_at &&
      new Date(s.scheduled_at).toLocaleDateString("en-CA", { timeZone }) ===
        today,
  ).length;
  const todayItems = buildTodayLane({
    inquiriesNeedingReply: allLeads.filter((l) => needsReply(l.status)).length,
    viewingsToday,
    messagesAwaitingApproval: pendingMessageCount ?? 0,
    rentIncreasesOverdue: rentIncreaseAlerts.filter(
      (a) => a.result.status === "overdue" || a.result.status === "serve_late",
    ).length,
    urgentWorkOrders: urgentWorkOrders.length,
  });

  const checklist = buildLaunchChecklist({
    propertyCount: propertyCount ?? 0,
    availabilityWindowCount: availabilityCount ?? 0,
    replyToConfigured: org ? isReplyToConfigured(org) : false,
    leadCount: allLeads.length,
    // "Go live" is satisfied by an active paid subscription OR an active pilot.
    subscriptionActive:
      isSubscriptionActive(org?.subscription_status) ||
      pilotStatus(org?.pilot_started_at).active,
    firstPropertyId:
      (availablePropertyRows as { id: string }[] | null)?.[0]?.id ?? null,
  });

  return (
    <div>
      <LaunchChecklist checklist={checklist} />

      <BrandBanner
        icon={<Icons.home />}
        eyebrow="Dashboard"
        title="Overview"
        subtitle="Everything that needs your attention, at a glance."
      />

      <TodayLane items={todayItems} />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Open inquiries"
          value={openLeads.length}
          icon={<Icons.chat className="h-4 w-4" />}
        />
        <StatCard
          label="New this week"
          value={newThisWeek.length}
          icon={<Icons.bolt className="h-4 w-4" />}
        />
        <StatCard
          label="Rentals"
          value={propertyCount ?? 0}
          icon={<Icons.building className="h-4 w-4" />}
        />
      </div>

      {rentIncreaseAlerts.length > 0 && (
        <>
          <SectionHeading>Rent increases due</SectionHeading>
          <div className="mb-8 grid grid-cols-1 gap-2">
            {rentIncreaseAlerts.map((a) => (
              <RentIncreaseRow
                key={a.id}
                result={a.result}
                label={a.label}
                href={`/dashboard/tenancies/${a.id}`}
              />
            ))}
          </div>
        </>
      )}

      {(pendingMessageCount ?? 0) > 0 && (
        <>
          <SectionHeading action={{ href: "/dashboard/messages", label: "Review messages" }}>
            Tenant messages
          </SectionHeading>
          <Link href="/dashboard/messages" className="mb-8 block">
            <div className="flex items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ring-1 ring-black/5"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                <Icons.mail className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">
                  {pendingMessageCount} tenant{" "}
                  {pendingMessageCount === 1 ? "message" : "messages"} awaiting your approval
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  Courtesy notes we&apos;ve drafted for your tenants. Nothing sends until you review and approve it.
                </p>
              </div>
            </div>
          </Link>
        </>
      )}

      {activeWorkOrders.length > 0 && (
        <>
          <SectionHeading action={{ href: "/dashboard/maintenance", label: "Open Maintenance" }}>
            Maintenance
          </SectionHeading>
          <Link href="/dashboard/maintenance" className="mb-8 block">
            <div className="flex items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ring-1 ring-black/5"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                <Icons.bolt className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">
                  {activeWorkOrders.length} open work{" "}
                  {activeWorkOrders.length === 1 ? "order" : "orders"}
                  {urgentWorkOrders.length > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-100">
                      {urgentWorkOrders.length} urgent
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  Repairs and maintenance still in progress. Open Maintenance to assign trades and track them to done.
                </p>
              </div>
            </div>
          </Link>
        </>
      )}

      <SectionHeading>Renters by stage</SectionHeading>
      <div className="mb-8 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {PIPELINE_STAGES.map((stage) => (
          <div
            key={stage}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-center shadow-sm sm:min-w-[5rem]"
          >
            <div
              className="text-xl font-bold tracking-tight"
              style={{ color: "var(--brand-color)" }}
            >
              {counts[stage]}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {statusLabel(stage)}
            </div>
          </div>
        ))}
      </div>

      <SectionHeading action={{ href: "/dashboard/showings", label: "View all" }}>
        Upcoming viewings
      </SectionHeading>
      {upcomingShowings.length === 0 ? (
        <div className="mb-8">
          <EmptyState
            icon={<Icons.calendar />}
            title="No upcoming viewings"
            description="Set your weekly availability so renters can book their own viewings online."
            cta={{ href: "/dashboard/availability", label: "Set availability" }}
          />
        </div>
      ) : (
        <ul className="mb-8 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {upcomingShowings.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm text-gray-900">
                {s.lead ? (
                  <Link
                    href={`/dashboard/leads/${s.lead.id}`}
                    className="hover:underline"
                  >
                    {s.lead.name || s.lead.email || "Renter"}
                  </Link>
                ) : (
                  "Renter"
                )}
                {s.property && (
                  <span className="ml-2 text-xs text-gray-400">
                    {s.property.address}
                  </span>
                )}
              </span>
              <span className="text-xs font-medium text-gray-500">
                {s.scheduled_at
                  ? new Date(s.scheduled_at).toLocaleString("en-US", {
                      timeZone,
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })
                  : "TBD"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SectionHeading action={{ href: "/dashboard/leads", label: "View all" }}>
        Recent inquiries
      </SectionHeading>
      {allLeads.length === 0 ? (
        <EmptyState
          icon={<Icons.chat />}
          title="No inquiries yet"
          description="Share a rental's public listing link to start collecting inquiries. They'll land here automatically."
          cta={{ href: "/dashboard/properties", label: "Open a rental" }}
        />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {allLeads.slice(0, 8).map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1 truncate text-gray-900">
                  {l.name || l.email || "Unnamed renter"}
                  {l.property?.address && (
                    <span className="ml-2 text-xs text-gray-500">
                      {l.property.address}
                    </span>
                  )}
                  {l.source && (
                    <span className="ml-2 text-xs text-gray-400">
                      via {l.source}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {l.qualified_out && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Possible mismatch
                    </span>
                  )}
                  {needsReply(l.status) && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Needs reply
                    </span>
                  )}
                  <StatusChip tone={leadStatusTone(l.status)}>
                    {statusLabel(l.status)}
                  </StatusChip>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
