import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PIPELINE_STAGES,
  statusLabel,
  type LeadStatus,
} from "@/lib/pipeline";

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
  const [{ data: leads }, { count: propertyCount }, { data: showingData }] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id, name, email, source, status, created_at, property_id")
        .order("created_at", { ascending: false }),
      supabase.from("properties").select("id", { count: "exact", head: true }),
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

  return (
    <div>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Open leads" value={openLeads.length} />
        <Stat label="New this week" value={newThisWeek.length} />
        <Stat label="Properties" value={propertyCount ?? 0} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Pipeline
      </h2>
      <div className="mb-8 flex flex-wrap gap-2">
        {PIPELINE_STAGES.map((stage) => (
          <div
            key={stage}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center"
          >
            <div className="text-lg font-bold text-gray-900">
              {counts[stage]}
            </div>
            <div className="text-xs text-gray-500">{statusLabel(stage)}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Upcoming showings
        </h2>
        <Link
          href="/dashboard/showings"
          className="text-sm font-medium text-brand"
        >
          View all →
        </Link>
      </div>
      {upcomingShowings.length === 0 ? (
        <p className="mb-8 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
          No upcoming showings. Set your{" "}
          <Link href="/dashboard/availability" className="text-brand">
            availability
          </Link>{" "}
          so renters can self-book.
        </p>
      ) : (
        <ul className="mb-8 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
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
                    {s.lead.name || s.lead.email || "Lead"}
                  </Link>
                ) : (
                  "Lead"
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

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Recent leads
        </h2>
        <Link href="/dashboard/leads" className="text-sm font-medium text-brand">
          View all →
        </Link>
      </div>

      {allLeads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No leads yet. Share a property&apos;s public listing link to start
          collecting inquiries.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {allLeads.slice(0, 8).map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <span className="text-gray-900">
                  {l.name || l.email || "Unnamed lead"}
                  {l.source && (
                    <span className="ml-2 text-xs text-gray-400">
                      via {l.source}
                    </span>
                  )}
                </span>
                <span className="text-xs font-medium text-gray-500">
                  {statusLabel(l.status)}
                </span>
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
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
    </div>
  );
}
