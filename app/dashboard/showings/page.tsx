import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { Icons } from "@/components/icons";
import { groupShowingsIntoBlocks, utcToLocalInputValue } from "@/lib/booking";
import {
  agentDisplayLabel,
  canAssignShowing,
  deriveCoordinationStatus,
  needsConfirmation,
  orgWeekWindow,
  suggestShowingAgent,
  normalizeProductTypes,
  type AgentSuggestion,
  type SuggestCandidate,
} from "@/lib/showing-agents";
import { getCurrentRole } from "@/lib/membership";
import { roleCan } from "@/lib/roles";
import { OutcomeSelect } from "./outcome-select";
import { AssignSelect } from "./assign-select";
import { ConfirmControl } from "./confirm-control";
import { RescheduleControl } from "./reschedule-control";

export const dynamic = "force-dynamic";

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string;
  assigned_agent_id: string | null;
  confirmed_at: string | null;
  lead: { id: string; name: string | null; email: string | null } | null;
  property: { id: string; address: string } | null;
  feedback: { rating: number | null; comments: string | null }[] | null;
};

type AgentRow = {
  id: string;
  name: string;
  tier: string | null;
  phone: string | null;
  archived: boolean;
  product_types: string[] | null;
  weekly_capacity: number | null;
};
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
  // Role-gate the write affordances so a showing_helper (server-blocked from both
  // actions) doesn't see forbidden-click controls (Codex P3).
  const role = await getCurrentRole();
  const canManageAgents = roleCan(role, "manage_settings");
  const canAssign = roleCan(role, "manage_leads");
  const { data } = await supabase
    .from("showings")
    .select(
      "id, scheduled_at, outcome, assigned_agent_id, confirmed_at, lead:leads(id, name, email), property:properties(id, address), feedback(rating, comments)",
    )
    .order("scheduled_at", { ascending: true });

  const all = (data ?? []) as unknown as ShowingRow[];

  // Showing-agent roster (S436). Active agents populate the assignment picker;
  // the full map labels a row whose assigned agent has since been archived.
  const { data: agentData } = await supabase
    .from("showing_agents")
    .select("id, name, tier, phone, archived, product_types, weekly_capacity")
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
  // Oversight (Slice 2): how many UPCOMING viewings are assigned but not yet
  // confirmed with the renter - the "did the agent follow up?" gap surfaced.
  const awaitingConfirmation = upcoming.filter((s) =>
    needsConfirmation(
      deriveCoordinationStatus({
        outcome: s.outcome,
        assignedAgentId: s.assigned_agent_id,
        confirmedAt: s.confirmed_at,
      }),
    ),
  ).length;

  // Suggested agent for the next viewing (S441) — a HINT the operator taps to
  // accept, never an auto-assign. Load-balances over each agent's non-cancelled
  // viewings scheduled THIS org-local week; capacity (when set) takes priority.
  const week = orgWeekWindow(now, timeZone);
  const assignedThisWeek = new Map<string, number>();
  for (const s of all) {
    if (!s.assigned_agent_id || s.outcome === "cancelled" || !s.scheduled_at) continue;
    const t = new Date(s.scheduled_at).getTime();
    if (t >= week.startMs && t < week.endMs) {
      assignedThisWeek.set(
        s.assigned_agent_id,
        (assignedThisWeek.get(s.assigned_agent_id) ?? 0) + 1,
      );
    }
  }
  const suggestCandidates: SuggestCandidate[] = agents
    .filter((a) => !a.archived)
    .map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      productTypes: normalizeProductTypes(a.product_types),
      weeklyCapacity: a.weekly_capacity,
      assignedThisWeek: assignedThisWeek.get(a.id) ?? 0,
      archived: false,
    }));
  // No property product-type column exists yet, so productType is left unset
  // (the scorer treats every agent as a generalist). Wiring is in place for when
  // properties gain a type.
  const suggestion: AgentSuggestion | null = suggestShowingAgent(suggestCandidates);
  // "Now" as a datetime-local wall value in the org tz — the reschedule picker's
  // `min`, so an operator can't pick a past time in the UI (the action also
  // rejects it server-side).
  const nowLocalValue = utcToLocalInputValue(new Date().toISOString(), timeZone);
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

      {canManageAgents && (
        <div className="mb-6 -mt-2">
          <Link
            href="/dashboard/showing-agents"
            className="text-sm font-medium text-brand hover:underline"
          >
            Manage showing agents →
          </Link>
        </div>
      )}

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
        canAssign={canAssign}
        suggestion={suggestion}
        allowReschedule
        nowLocalValue={nowLocalValue}
        note={
          canAssign && awaitingConfirmation > 0 ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {awaitingConfirmation} assigned{" "}
              {awaitingConfirmation === 1 ? "viewing is" : "viewings are"} awaiting
              confirmation with the renter.
            </p>
          ) : undefined
        }
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
        canAssign={canAssign}
      />
      {cancelled.length > 0 && (
        <Section
          title={`Cancelled (${cancelled.length})`}
          rows={cancelled}
          timeZone={timeZone}
          agentOptions={activeAgentOptions}
          agentLabelById={agentLabelById}
          agentContactById={agentContactById}
          canAssign={canAssign}
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
  canAssign,
  suggestion,
  allowReschedule,
  nowLocalValue,
  note,
}: {
  title: string;
  rows: ShowingRow[];
  empty?: React.ReactNode;
  timeZone: string;
  agentOptions: AgentOption[];
  agentLabelById: Map<string, string>;
  agentContactById: Map<string, { name: string; phone: string | null }>;
  canAssign: boolean;
  suggestion?: AgentSuggestion | null;
  allowReschedule?: boolean;
  nowLocalValue?: string;
  note?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <SectionHeading>{title}</SectionHeading>
      {note ?? null}
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
            const coordStatus = deriveCoordinationStatus({
              outcome: s.outcome,
              assignedAgentId: s.assigned_agent_id,
              confirmedAt: s.confirmed_at,
            });
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
                    {canAssignShowing(s.outcome) && canAssign && (
                      <AssignSelect
                        showingId={s.id}
                        assignedAgentId={s.assigned_agent_id}
                        agents={rowAgentOptions}
                        suggestion={
                          !s.assigned_agent_id &&
                          suggestion &&
                          rowAgentOptions.some((o) => o.id === suggestion.agentId)
                            ? suggestion
                            : null
                        }
                      />
                    )}
                    {canAssignShowing(s.outcome) && !canAssign && assignedLabel && (
                      <span className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-600">
                        {assignedLabel}
                      </span>
                    )}
                    <OutcomeSelect showingId={s.id} outcome={s.outcome} />
                  </div>
                  {canAssign && (
                    <ConfirmControl showingId={s.id} status={coordStatus} />
                  )}
                  {allowReschedule &&
                    canAssign &&
                    canAssignShowing(s.outcome) &&
                    s.scheduled_at && (
                      <RescheduleControl
                        showingId={s.id}
                        defaultLocalValue={utcToLocalInputValue(
                          s.scheduled_at,
                          timeZone,
                        )}
                        minLocalValue={nowLocalValue ?? ""}
                      />
                    )}
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
