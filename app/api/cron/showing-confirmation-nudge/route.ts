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
  confirmationNudgeDue,
  CONFIRMATION_NUDGE_LEAD_MS,
  CONFIRMATION_NUDGE_SENT_COLUMN,
} from "@/lib/reminders";

// Pre-showing UNCONFIRMED-nudge sweep (S440, showing routing Slice 3) — the
// mirror of the post-showing outcome nudge. When an assigned viewing is coming up
// (within 24h) and still hasn't been confirmed with the renter, the ASSIGNED
// AGENT gets ONE reminder with a one-tap {{agent_url}} link to their shared
// calendar, so an unconfirmed viewing doesn't silently slip and the lead agent
// doesn't have to chase. Closes the "did anyone confirm this?" gap the "Howard"
// episode exposed.
//
// EMAIL only, via the notification substrate. The assigned agent is the natural
// party and is ALWAYS included (audienceEmail); an org can add CC recipients
// (e.g. the lead agent) in Settings. When the agent has no email on file, the
// nudge falls back to the operator members so someone still sees it. ONE nudge
// per showing: confirmationNudgeDue gates on assigned + unconfirmed + open + a
// future start within 24h, and confirmation_nudge_sent_at is stamped after send.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns "Unconfirmed viewing reminder" on in Settings -> Notifications.
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
const EVENT_KEY = "leasing.showing_unconfirmed_nudge";

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
  confirmed_at: string | null;
  assigned_agent_id: string | null;
  lead: { name: string | null } | null;
  property: { address: string | null } | null;
  assigned_agent: { name: string | null; email: string | null; agent_token: string | null } | null;
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
    .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone");
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  // The pre-showing band: scheduled_at in [now, now+LEAD] — future, within 24h.
  const soonestIso = new Date(nowMs).toISOString();
  const latestIso = new Date(nowMs + CONFIRMATION_NUDGE_LEAD_MS).toISOString();

  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";

      // Opt-in gate (ship dark): only sweep orgs that have turned the event on.
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

      // Upcoming assigned viewings in the band, unconfirmed, with an open outcome
      // and (unless forced) no nudge sent yet. Per-row confirmationNudgeDue
      // re-checks precisely.
      let q = admin
        .from("showings")
        .select(
          "id, scheduled_at, outcome, confirmed_at, assigned_agent_id, " +
            "lead:leads(name), property:properties(address), " +
            "assigned_agent:showing_agents(name, email, agent_token)",
        )
        .eq("organization_id", org.id)
        .not("assigned_agent_id", "is", null)
        .is("confirmed_at", null)
        .gte("scheduled_at", soonestIso)
        .lte("scheduled_at", latestIso)
        .or("outcome.is.null,outcome.eq.scheduled");
      if (!force) q = q.is("confirmation_nudge_sent_at", null);
      const { data: showRows } = await q;

      // Operator members, resolved once per org and only if needed (the fallback
      // for an assigned agent with no email on file).
      let operatorMembers: string[] | null = null;
      const ensureMembers = async (): Promise<string[]> => {
        if (operatorMembers) return operatorMembers;
        const { data: memberRows } = await admin
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", org.id);
        const members: NotifyMember[] = [];
        for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
          const { data: u } = await admin.auth.admin.getUserById(m.user_id);
          members.push({ role: m.role, email: u?.user?.email ?? null });
        }
        operatorMembers = resolveLeadNotifyEmails(members, [
          org.reply_to_email,
          org.public_contact_email,
        ]).slice(0, MAX_RECIPIENTS);
        return operatorMembers;
      };

      for (const raw of (showRows ?? []) as any[]) {
        const row = raw as ShowingRow;
        try {
          const scheduledAt = row.scheduled_at;
          if (!scheduledAt) {
            summary.skipped++;
            continue;
          }
          const due = confirmationNudgeDue({
            scheduledAtMs: new Date(scheduledAt).getTime(),
            nowMs,
            assigned: row.assigned_agent_id != null,
            confirmed: row.confirmed_at != null,
            outcome: row.outcome,
            alreadySent: false, // SQL already excluded sent rows (or force re-sends)
          });
          if (!due) {
            summary.skipped++;
            continue;
          }

          const lead = one<{ name: string | null }>(row.lead);
          const prop = one<{ address: string | null }>(row.property);
          const agent = one<{ name: string | null; email: string | null; agent_token: string | null }>(
            row.assigned_agent,
          );
          // Without a token there is no /agent link to send — skip (defensive; the
          // 0117 backfill gives every agent a token).
          if (!agent?.agent_token) {
            summary.skipped++;
            continue;
          }
          const leadName = lead?.name?.trim() || "a renter";
          const address = prop?.address?.trim() || "the property";
          const agentEmail = agent.email?.trim() || null;
          const vars: Record<string, string> = {
            org_name: org.name ?? "",
            property_address: address,
            lead_name: leadName,
            agent_name: agent.name?.trim() || "there",
            showing_time: fmtShowingTime(scheduledAt, tz),
            agent_url: `${APP_URL}/agent/${agent.agent_token}`,
          };

          // The assigned agent is the natural recipient (audienceEmail = always
          // included). Only fall back to operator members when the agent has no
          // email, so a routine confirmation reminder doesn't spam the whole team.
          const fallback = agentEmail ? [] : await ensureMembers();

          if (dry) {
            const rendered = renderNotification(event, setting, vars);
            const recipients = resolveNotificationRecipients({
              audience: event.audience,
              configured: setting?.recipients ?? [],
              audienceEmail: agentEmail,
              operatorFallback: fallback,
            });
            summary.sent++; // "would send"
            summary.details.push({
              org: org.id,
              showing: row.id,
              dry: true,
              enabled: isEventEnabled(setting),
              recipients,
              subject: rendered.subject,
              agent_url: vars.agent_url,
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
            audienceEmail: agentEmail,
            operatorFallback: fallback,
            vars,
            action: { label: "Confirm the viewing", url: vars.agent_url },
          });

          // The email IS the product action, so only stamp confirmation_nudge_sent_at
          // when at least one email actually sent. A provider failure / empty
          // recipient resolution must NOT consume the one allowed nudge — leave the
          // row unstamped so the next sweep retries once the cause clears.
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

          await admin
            .from("showings")
            .update({ [CONFIRMATION_NUDGE_SENT_COLUMN]: new Date().toISOString() })
            .eq("id", row.id);

          summary.sent++;
          summary.details.push({ org: org.id, showing: row.id, sent: true });
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
