import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { Icons } from "@/components/icons";
import { groupShowingsIntoBlocks } from "@/lib/booking";
import { agentDisplayLabel, canAssignShowing } from "@/lib/showing-agents";
import { OutcomeSelect } from "./outcome-select";
import { AssignSelect } from "./assign-select";

export const dynamic = "force-dynamic";

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string;
  assigned_agent_id: string | null;
  lead: { id: string; name: string | null; email: string | null } | null;
  property: { id: string; address: string } | null;
  feedback: { rating: number | null; comments: string | null }[] | null;
};

type AgentRow = { id: string; name: string; tier: string | null; phone: string | null; archived: boolean };
type AgentOption = { id: string; label: string };

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-gray-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

// Format in the org's booking timezone. Without an explicit timeZone the
// server (UTC on Vercel) renders the wrong wall-clock time.
function fmt(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function fmtClock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDayShort(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default async function ShowingsPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();
  const timeZone = org?.booking_timezone ?? "America/Toronto";
  const { data } = await supabase
    .from("showings")
    .select(
      "id, scheduled_at, outcome, assigned_agent_id, lead:leads(id, name, email), property:properties(id, address), feedback(rating, comments)",
    )
    .order("scheduled_at", { ascending: true });

  const all = (data ?? []) as unknown as ShowingRow[];

  // Showing-agent roster (S436). Active agents populate the assignment picker;
  // the full map labels a row whose assigned agent has since been archived.
  const { data: agentData } = await supabase
    .from("showing_agents")
    .select("id, name, tier, phone, archived")
    .order("name", { ascending: true });
  const agents = (agentData ?? []) as AgentRow[];
  const activeAgentOptions: AgentOption[] = agents
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, label: agentDisplayLabel(a) }));
  const agentLabelById = new Map(agents.map((a) => [a.id, agentDisplayLabel(a)]));
  // Assigned-agent contact (Slice 1.5): tap-to-text / tap-to-call the person
  // running THIS viewing, so a renter's "running late" note can be relayed to
  // whoever is covering - not a hardcoded office number.
  const agentContactById = new Map(
    agents.map((a) => [a.id, { name: a.name, phone: a.phone }]),
  );
  const now = Date.now();
  const upcoming = all.filter(
    (s) =>
      s.outcome === "scheduled" &&
      s.scheduled_at != null &&
      new Date(s.scheduled_at).getTime() >= now,
  );
  const byRecent = (a: ShowingRow, b: ShowingRow) =>
    new Date(b.scheduled_at ?? 0).getTime() -
    new Date(a.scheduled_at ?? 0).getTime();
  // Cancelled viewings are pulled into their own group: a cancelled viewing whose
  // date is still in the future reads as misleading under a date-based "Past"
  // heading, so it never belongs there regardless of when it was scheduled.
  const cancelled = all
    .filter((s) => s.outcome === "cancelled")
    .sort(byRecent);
  // Past & closed = everything that isn't upcoming and isn't cancelled: viewings
  // that already happened (attended / no-show) plus scheduled ones whose time
  // has passed. This grouping is now genuinely "done", not just "before now".
  const past = all
    .filter((s) => !upcoming.includes(s) && s.outcome !== "cancelled")
    .sort(byRecent);

  // Route view: when clustering is on, group upcoming showings into building+day
  // blocks (2+ showings) so the agent sees what's grouped where.
  const blocks = org?.clustering_enabled
    ? groupShowingsIntoBlocks(
        upcoming.map((s) => ({
          scheduled_at: s.scheduled_at,
          address: s.property?.address ?? null,
        })),
        timeZone,
      ).filter((b) => b.count >= 2)
    : [];

  return (
    <div>
      <PageHeader
        icon={<Icons.calendar />}
        title="Viewings"
        subtitle="Viewings renters booked online, plus ones you scheduled. Mark the outcome after each one to keep your renter list accurate."
      />

      <div className="mb-6 -mt-2">
        <Link
          href="/dashboard/showing-agents"
          className="text-sm font-medium text-brand hover:underline"
        >
          Manage showing agents →
        </Link>
      </div>

      {blocks.length > 0 && (
        <div className="mb-8">
          <SectionHeading>Grouped by building</SectionHeading>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {blocks.map((b) => (
              <li
                key={b.key}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-gray-900">
                  {b.buildingLabel}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {fmtDayShort(b.startIso, timeZone)} ·{" "}
                  {fmtClock(b.startIso, timeZone)} – {fmtClock(b.endIso, timeZone)}
                </p>
                <span className="mt-2 inline-block rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                  {b.count} viewings
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section
        title={`Upcoming (${upcoming.length})`}
        rows={upcoming}
        empty={
          <EmptyState
            icon={<Icons.calendar className="h-5 w-5" />}
            title="No upcoming viewings yet"
            description="Set your weekly availability so renters can book their own viewings online. Confirmed viewings appear here."
            cta={{ href: "/dashboard/availability", label: "Set availability" }}
          />
        }
        timeZone={timeZone}
        agentOptions={activeAgentOptions}
        agentLabelById={agentLabelById}
        agentContactById={agentContactById}
      />
      <Section
        title="Past & closed"
        rows={past}
        empty={
          <EmptyState
            icon={<Icons.check className="h-5 w-5" />}
            title="No past viewings yet"
            description="Once renters attend, mark each outcome here (attended or no-show) to keep your renter list accurate."
          />
        }
        timeZone={timeZone}
        agentOptions={activeAgentOptions}
        agentLabelById={agentLabelById}
        agentContactById={agentContactById}
      />
      {cancelled.length > 0 && (
        <Section
          title={`Cancelled (${cancelled.length})`}
          rows={cancelled}
          timeZone={timeZone}
          agentOptions={activeAgentOptions}
          agentLabelById={agentLabelById}
          agentContactById={agentContactById}
        />
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  empty,
  timeZone,
  agentOptions,
  agentLabelById,
  agentContactById,
}: {
  title: string;
  rows: ShowingRow[];
  empty?: React.ReactNode;
  timeZone: string;
  agentOptions: AgentOption[];
  agentLabelById: Map<string, string>;
  agentContactById: Map<string, { name: string; phone: string | null }>;
}) {
  return (
    <div className="mb-8">
      <SectionHeading>{title}</SectionHeading>
      {rows.length === 0 ? (
        empty ?? null
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm">
          {rows.map((s) => {
            const fb = s.feedback?.[0];
            // The assignment picker offers active agents; if this viewing is
            // assigned to an agent who's since been archived, surface that agent
            // as an extra option so the row reads correctly (not "Unassigned").
            const assignedLabel = s.assigned_agent_id
              ? agentLabelById.get(s.assigned_agent_id)
              : null;
            const rowAgentOptions =
              s.assigned_agent_id &&
              !agentOptions.some((o) => o.id === s.assigned_agent_id)
                ? [
                    ...agentOptions,
                    {
                      id: s.assigned_agent_id,
                      label: `${assignedLabel ?? "Agent"} (archived)`,
                    },
                  ]
                : agentOptions;
            const contact = s.assigned_agent_id
              ? agentContactById.get(s.assigned_agent_id)
              : null;
            // tel:/sms: want just digits and a leading +; the stored phone is
            // free text so strip everything else.
            const contactDigits = contact?.phone
              ? contact.phone.replace(/[^\d+]/g, "")
              : "";
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {fmt(s.scheduled_at, timeZone)}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {s.lead ? (
                      <Link
                        href={`/dashboard/leads/${s.lead.id}`}
                        className="text-brand hover:underline"
                      >
                        {s.lead.name || s.lead.email || "Renter"}
                      </Link>
                    ) : (
                      "Renter"
                    )}
                    {s.property ? ` · ${s.property.address}` : ""}
                  </p>
                  {fb && fb.rating != null && (
                    <p className="mt-1 text-xs">
                      <Stars rating={fb.rating} />
                      {fb.comments ? (
                        <span className="ml-2 text-gray-500">“{fb.comments}”</span>
                      ) : null}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {canAssignShowing(s.outcome) && (
                      <AssignSelect
                        showingId={s.id}
                        assignedAgentId={s.assigned_agent_id}
                        agents={rowAgentOptions}
                      />
                    )}
                    <OutcomeSelect showingId={s.id} outcome={s.outcome} />
                  </div>
                  {contact && contactDigits !== "" && (
                    <p className="text-xs text-gray-500">
                      {contact.name}:{" "}
                      <a
                        href={`sms:${contactDigits}`}
                        className="font-medium text-brand hover:underline"
                      >
                        Text
                      </a>
                      {" · "}
                      <a
                        href={`tel:${contactDigits}`}
                        className="font-medium text-brand hover:underline"
                      >
                        Call
                      </a>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
