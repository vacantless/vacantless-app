// S728: env + database half of the viewings calendar feed (pure: lib/calendar-feed.ts).
import { createAdminClient } from "@/lib/supabase/admin";
import { signCalendarFeedToken, verifyCalendarFeedToken, type FeedSubject, type FeedViewing } from "@/lib/calendar-feed";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || "";
}

/** The subscribe URL, or "" when the server has no key. */
export function calendarFeedUrl(subject: FeedSubject): string {
  const s = secret();
  if (!s) return "";
  return `${APP_URL}/calendar/feed/${signCalendarFeedToken(subject, s)}.ics`;
}

const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 120;

export async function loadCalendarFeed(token: string): Promise<{ name: string; viewings: FeedViewing[] } | null> {
  const subject = verifyCalendarFeedToken(token, secret());
  if (!subject) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, booking_slot_minutes, closed_at")
    .eq("id", subject.orgId)
    .maybeSingle();
  const o = org as { id: string; name: string | null; booking_slot_minutes: number | null; closed_at: string | null } | null;
  if (!o || o.closed_at) return null;
  let agentName: string | null = null;
  if (subject.kind === "agent") {
    const { data: agent } = await admin
      .from("showing_agents")
      .select("id, name, active")
      .eq("id", subject.agentId)
      .eq("organization_id", subject.orgId)
      .maybeSingle();
    const a = agent as { id: string; name: string | null; active: boolean | null } | null;
    if (!a || a.active === false) return null;
    agentName = a.name ?? null;
  }
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const until = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString();
  let q = admin
    .from("showings")
    .select("id, scheduled_at, outcome, assigned_agent_id, lead:leads(name), property:properties(address), agent:showing_agents!showings_assigned_agent_id_fkey(name)")
    .eq("organization_id", subject.orgId)
    .gte("scheduled_at", since)
    .lte("scheduled_at", until)
    .order("scheduled_at", { ascending: true })
    .limit(500);
  if (subject.kind === "agent") q = q.eq("assigned_agent_id", subject.agentId);
  const { data } = await q;
  type Rel<T> = T | T[] | null;
  const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? r[0] ?? null : r);
  const rows = (data ?? []) as Array<{
    id: string;
    scheduled_at: string | null;
    outcome: string | null;
    lead: Rel<{ name: string | null }>;
    property: Rel<{ address: string | null }>;
    agent: Rel<{ name: string | null }>;
  }>;
  const viewings: FeedViewing[] = rows
    .filter((r) => !!r.scheduled_at)
    .map((r) => ({
      showingId: r.id,
      startIso: r.scheduled_at as string,
      minutes: o.booking_slot_minutes || 30,
      address: one(r.property)?.address ?? null,
      orgName: o.name,
      renterName: one(r.lead)?.name ?? null,
      cancelled: r.outcome === "cancelled",
      pageUrl: `${APP_URL}/dashboard/showings`,
      updatedIso: null,
      agentName: one(r.agent)?.name ?? null,
    }));
  const name = subject.kind === "agent" ? `${o.name ?? "Vacantless"} viewings (${agentName ?? "agent"})` : `${o.name ?? "Vacantless"} viewings`;
  return { name, viewings };
}
