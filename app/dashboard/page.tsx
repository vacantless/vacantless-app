import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PIPELINE_STAGES,
  statusLabel,
  type LeadStatus,
} from "@/lib/pipeline";
import {
  buildLaunchChecklist,
  isBrandingConfirmed,
} from "@/lib/onboarding";
import { isSubscriptionActive, pilotStatus } from "@/lib/billing";
import {
  Card,
  SectionHeading,
  EmptyState,
  StatusChip,
  leadStatusTone,
} from "@/components/ui";
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
      .select("id, name, email, source, status, created_at, property_id")
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

  const allLeads = (leads ?? []) as LeadRow[];
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

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Open inquiries" value={openLeads.length} />
        <Stat label="New this week" value={newThisWeek.length} />
        <Stat label="Properties" value={propertyCount ?? 0} />
      </div>

      <SectionHeading>Renters by stage</SectionHeading>
      <div className="mb-8 flex flex-wrap gap-2">
        {PIPELINE_STAGES.map((stage) => (
          <div
            key={stage}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center shadow-sm"
          >
            <div className="text-lg font-bold text-gray-900">
              {counts[stage]}
            </div>
            <div className="text-xs text-gray-500">{statusLabel(stage)}</div>
          </div>
        ))}
      </div>

      <SectionHeading action={{ href: "/dashboard/showings", label: "View all" }}>
        Upcoming showings
      </SectionHeading>
      {upcomingShowings.length === 0 ? (
        <div className="mb-8">
          <EmptyState
            title="No upcoming showings"
            description="Set your weekly availability so renters can book their own showings online."
            cta={{ href: "/dashboard/availability", label: "Set availability" }}
          />
        </div>
      ) : (
        <ul className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
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
          title="No inquiries yet"
          description="Share a property's public listing link to start collecting inquiries. They'll land here automatically."
          cta={{ href: "/dashboard/properties", label: "Open a property" }}
        />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
          {allLeads.slice(0, 8).map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <span className="min-w-0 truncate text-gray-900">
                  {l.name || l.email || "Unnamed renter"}
                  {l.source && (
                    <span className="ml-2 text-xs text-gray-400">
                      via {l.source}
                    </span>
                  )}
                </span>
                <StatusChip tone={leadStatusTone(l.status)}>
                  {statusLabel(l.status)}
                </StatusChip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
    </Card>
  );
}
