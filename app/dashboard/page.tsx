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
  isBrandingConfirmed,
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
    { data: propertyRows, count: propertyCount },
    { count: availabilityCount },
    { data: showingData },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, name, email, source, status, created_at, property_id, qualified_out, property:properties(address)",
      )
      .order("created_at", { ascending: false }),
    // Most-recent property id + total count — the id deep-links the "test your
    // intake page" checklist step straight to a real public /r page.
    supabase
      .from("properties")
      .select("id", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(1),
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
  ]);

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

  const checklist = buildLaunchChecklist({
    propertyCount: propertyCount ?? 0,
    availabilityWindowCount: availabilityCount ?? 0,
    brandingConfirmed: org ? isBrandingConfirmed(org) : false,
    leadCount: allLeads.length,
    // "Go live" is satisfied by an active paid subscription OR an active pilot.
    subscriptionActive:
      isSubscriptionActive(org?.subscription_status) ||
      pilotStatus(org?.pilot_started_at).active,
    firstPropertyId: (propertyRows as { id: string }[] | null)?.[0]?.id ?? null,
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
