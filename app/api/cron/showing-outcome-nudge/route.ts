import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  isEventEnabled,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import {
  outcomeNudgeStepDue,
  OUTCOME_NUDGE_GRACE_MS,
  OUTCOME_NUDGE_MAX_AGE_MS,
  OUTCOME_NUDGE_SENT_COLUMN,
  OUTCOME_NUDGE_COUNT_COLUMN,
} from "@/lib/reminders";

// Post-showing outcome-nudge sweep (S392, escalation added S445 slice 2) — the
// trigger that lights up the one-tap outcome surface. Once a showing's time passes
// with no outcome recorded, a "how did the viewing go?" email goes out with a
// one-tap record link. This makes recording an outcome a PUSH (mirroring Aaliyah's
// tap-a-link habit) instead of a PULL nobody does — the conversion audit found 94
// booked showings with 1 recorded outcome.
//
// TARGET: the ASSIGNED AGENT (who was on-site + can one-tap it on their /agent
// page) when the viewing is assigned and the agent has an email; otherwise the
// OPERATOR with the /showing/[token] outcome page. EMAIL only, via the notification
// substrate (per-org editable template + branding + recipients).
//
// BOUNDED ESCALATION: not one ignorable email — up to organizations.outcome_nudge_max
// nudges (1 = "just once", 3 = "follow up until answered"), spaced by
// OUTCOME_NUDGE_OFFSETS_MS (fresh / next-morning / final) and capped by the 7d
// backlog bound. The per-row outcomeNudgeStepDue gates the NEXT step on the send
// count; recording the outcome makes every future call false, so the series STOPS
// the instant it's answered. outcome_nudge_count is bumped + outcome_nudge_sent_at
// stamped after each send.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns the "Post-showing outcome reminder" event on in Settings -> Notifications
// (that toggle is the "off"; the cadence cap is the "once vs follow-up").
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-sent stamp (still sends + re-stamps)
//   ?dry=1      build + return what WOULD send, without sending or stamping
//
// Reads showings across all orgs via the service-role client (RLS hides them from
// anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.showing_outcome_nudge";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // emails sent (or "would send" in dry mode)
  skipped: number; // orgs/showings not actionable / opt-out
  errors: number;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured → refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

function fmtShowingTime(iso: string | null, tz: string): string {
  if (!iso) return "the scheduled time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  outcome_token: string;
  outcome_nudge_count: number | null;
  assigned_agent_id: string | null;
  lead: { name: string | null } | null;
  property: { address: string | null } | null;
};

type AgentRow = {
  id: string;
  name: string;
  email: string | null;
  agent_token: string;
  archived: boolean;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  const event = getNotificationEvent(EVENT_KEY);
  if (!event) {
    return NextResponse.json(
      { ok: false, reason: "event_not_registered", scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  let orgQuery = admin
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone, outcome_nudge_max",
    );
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  // The viewing-over .. backlog-bound band: scheduled_at in [now-MAX_AGE, now-GRACE].
  const oldestIso = new Date(nowMs - OUTCOME_NUDGE_MAX_AGE_MS).toISOString();
  const newestIso = new Date(nowMs - OUTCOME_NUDGE_GRACE_MS).toISOString();

  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";

      // Opt-in gate (ship dark): only sweep orgs that have turned the event on.
      // Absent row => isDripEnqueueEnabled false => skip.
      const { data: settingRow } = await admin
        .from("notification_settings")
        .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
        .eq("organization_id", org.id)
        .eq("event_key", EVENT_KEY)
        .maybeSingle();
      const setting = (settingRow as NotificationSettingRow | null) ?? null;
      if (!isDripEnqueueEnabled(setting)) {
        summary.skipped++;
        continue;
      }

      const maxNudges: number =
        typeof org.outcome_nudge_max === "number" ? org.outcome_nudge_max : 3;

      // Showings whose time is in the band with no real outcome yet. The per-row
      // outcomeNudgeStepDue re-checks precisely against the send count + the org's
      // cadence cap, so we no longer pre-filter on a single sent stamp (bounded
      // escalation can send more than once).
      const { data: showRows } = await admin
        .from("showings")
        .select(
          "id, scheduled_at, outcome, outcome_token, outcome_nudge_count, assigned_agent_id, " +
            "lead:leads(name), property:properties(address)",
        )
        .eq("organization_id", org.id)
        .gte("scheduled_at", oldestIso)
        .lte("scheduled_at", newestIso)
        .or("outcome.is.null,outcome.eq.scheduled");

      // The org's showing-agent roster (id -> contact), so a nudge for an ASSIGNED
      // viewing can go to the agent who was on-site (the person who actually knows
      // the outcome + can one-tap it on their /agent page), falling back to the
      // operator only when the viewing is unassigned or the agent has no email.
      // Fetched once per org, lazily.
      let agentsById: Map<string, AgentRow> | null = null;
      const ensureAgents = async (): Promise<Map<string, AgentRow>> => {
        if (agentsById) return agentsById;
        const { data: agentRows } = await admin
          .from("showing_agents")
          .select("id, name, email, agent_token, archived")
          .eq("organization_id", org.id);
        agentsById = new Map(
          ((agentRows ?? []) as AgentRow[]).map((a) => [a.id, a]),
        );
        return agentsById;
      };

      // Resolve the operator recipients once per org, only if something is due.
      let operatorFallback: string[] | null = null;
      const ensureFallback = async (): Promise<string[]> => {
        if (operatorFallback) return operatorFallback;
        const { data: memberRows } = await admin
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", org.id);
        const members: NotifyMember[] = [];
        for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
          const { data: u } = await admin.auth.admin.getUserById(m.user_id);
          members.push({ role: m.role, email: u?.user?.email ?? null });
        }
        operatorFallback = resolveLeadNotifyEmails(members, [
          org.reply_to_email,
          org.public_contact_email,
        ]).slice(0, MAX_RECIPIENTS);
        return operatorFallback;
      };

      for (const raw of (showRows ?? []) as any[]) {
        const row = raw as ShowingRow;
        try {
          const scheduledAt = row.scheduled_at;
          if (!scheduledAt) {
            summary.skipped++;
            continue;
          }
          // `force` re-evaluates from zero (test affordance); otherwise the real
          // per-showing send count is gated against the org's cadence cap.
          const nudgeCount = force ? 0 : row.outcome_nudge_count ?? 0;
          const due = outcomeNudgeStepDue({
            scheduledAtMs: new Date(scheduledAt).getTime(),
            nowMs,
            outcome: row.outcome,
            nudgeCount,
            maxNudges,
          });
          if (!due) {
            summary.skipped++;
            continue;
          }

          const lead = one<{ name: string | null }>(row.lead);
          const prop = one<{ address: string | null }>(row.property);
          const leadName = lead?.name?.trim() || "a renter";
          const address = prop?.address?.trim() || "the property";

          // Route to the ON-SITE agent when the viewing is assigned + the agent has
          // an email (they know the outcome and can one-tap it on their /agent page);
          // otherwise fall back to the operator + the /showing outcome page.
          let audienceEmail: string | null = null;
          let outcomeUrl = `${APP_URL}/showing/${row.outcome_token}`;
          if (row.assigned_agent_id) {
            const agents = await ensureAgents();
            const agent = agents.get(row.assigned_agent_id);
            if (agent && !agent.archived && agent.email) {
              audienceEmail = agent.email;
              outcomeUrl = `${APP_URL}/agent/${agent.agent_token}`;
            }
          }
          const toAgent = audienceEmail !== null;

          const vars: Record<string, string> = {
            org_name: org.name ?? "",
            property_address: address,
            lead_name: leadName,
            showing_time: fmtShowingTime(scheduledAt, tz),
            outcome_url: outcomeUrl,
          };

          // Operator fallback is only relevant when we're NOT routing to the agent.
          const fallback = toAgent ? [] : await ensureFallback();

          if (dry) {
            const rendered = renderNotification(event, setting, vars);
            const recipients = resolveNotificationRecipients({
              audience: event.audience,
              configured: setting?.recipients ?? [],
              audienceEmail,
              operatorFallback: fallback,
            });
            summary.sent++; // "would send"
            summary.details.push({
              org: org.id,
              showing: row.id,
              dry: true,
              enabled: isEventEnabled(setting),
              to: toAgent ? "agent" : "operator",
              nudge_step: nudgeCount + 1,
              recipients,
              subject: rendered.subject,
              outcome_url: vars.outcome_url,
            });
            continue;
          }

          const result = await sendOrgNotification({
            client: admin,
            org: {
              id: org.id,
              name: org.name,
              brand_color: org.brand_color,
              logo_url: org.logo_url,
              reply_to_email: org.reply_to_email,
            },
            eventKey: EVENT_KEY,
            audienceEmail,
            vars,
            operatorFallback: fallback,
            action: { label: "Record the outcome", url: vars.outcome_url },
          });

          // For THIS cron the email IS the product action, so only stamp
          // outcome_nudge_sent_at when at least one operator email actually sent.
          // A missing BREVO key / provider failure / disabled-event race / empty
          // recipient resolution must NOT consume the one allowed nudge and
          // permanently suppress retry — leave the row unstamped so the next sweep
          // retries once the cause clears. (P2, Best-In-Class QA 2026-07-01.)
          if (!result.delivered) {
            summary.skipped++;
            summary.details.push({
              org: org.id,
              showing: row.id,
              sent: false,
              not_stamped: true,
              reason: result.skipped ?? "send_failed",
              attempted: result.attempted,
            });
            continue;
          }

          // Bounded escalation: bump the send count (off the REAL prior count, not
          // the force-zeroed one) and record the last-sent time. The next sweep's
          // outcomeNudgeStepDue gates the following step on this count + the cap.
          await admin
            .from("showings")
            .update({
              [OUTCOME_NUDGE_COUNT_COLUMN]: (row.outcome_nudge_count ?? 0) + 1,
              [OUTCOME_NUDGE_SENT_COLUMN]: new Date().toISOString(),
            })
            .eq("id", row.id);

          summary.sent++;
          summary.details.push({
            org: org.id,
            showing: row.id,
            sent: true,
            to: toAgent ? "agent" : "operator",
            nudge_step: (row.outcome_nudge_count ?? 0) + 1,
          });
        } catch (e: any) {
          summary.errors++;
          summary.details.push({ org: org.id, showing: row?.id, error: `row_threw:${String(e?.message ?? e)}` });
        }
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
