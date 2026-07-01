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
  outcomeNudgeDue,
  OUTCOME_NUDGE_GRACE_MS,
  OUTCOME_NUDGE_MAX_AGE_MS,
  OUTCOME_NUDGE_SENT_COLUMN,
} from "@/lib/reminders";

// Post-showing outcome-nudge sweep (S392, Slice 3) — the trigger that lights up
// the one-tap surface built in Slice 2. Once a showing's time passes with no
// outcome recorded, the OPERATOR gets ONE "how did the viewing go?" email with a
// /showing/[token] link that records Attended / No-show / Cancelled in a tap.
// This makes recording an outcome a PUSH (mirroring Aaliyah's tap-a-link habit)
// instead of a PULL nobody does — the conversion audit found 94 booked showings
// with 1 recorded outcome.
//
// EMAIL only, via the notification substrate (operator audience, per-org editable
// template + branding + recipients). ONE nudge per showing: the per-row decision
// (outcomeNudgeDue) gates on a 2h grace + a 7d backlog bound + outcome still
// blank, and outcome_nudge_sent_at is stamped after send so a re-run never
// double-sends.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns the "Post-showing outcome reminder" event on in Settings -> Notifications.
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
  lead: { name: string | null } | null;
  property: { address: string | null } | null;
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

      // Showings whose time is in the band, with no real outcome and (unless
      // forced) no nudge sent yet. The per-row outcomeNudgeDue re-checks precisely.
      let q = admin
        .from("showings")
        .select(
          "id, scheduled_at, outcome, outcome_token, " +
            "lead:leads(name), property:properties(address)",
        )
        .eq("organization_id", org.id)
        .gte("scheduled_at", oldestIso)
        .lte("scheduled_at", newestIso)
        .or("outcome.is.null,outcome.eq.scheduled");
      if (!force) q = q.is("outcome_nudge_sent_at", null);
      const { data: showRows } = await q;

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
          const due = outcomeNudgeDue({
            scheduledAtMs: new Date(scheduledAt).getTime(),
            nowMs,
            outcome: row.outcome,
            alreadySent: false, // SQL already excluded sent rows (or force re-sends)
          });
          if (!due) {
            summary.skipped++;
            continue;
          }

          const lead = one<{ name: string | null }>(row.lead);
          const prop = one<{ address: string | null }>(row.property);
          const leadName = lead?.name?.trim() || "a prospect";
          const address = prop?.address?.trim() || "the property";
          const vars: Record<string, string> = {
            org_name: org.name ?? "",
            property_address: address,
            lead_name: leadName,
            showing_time: fmtShowingTime(scheduledAt, tz),
            outcome_url: `${APP_URL}/showing/${row.outcome_token}`,
          };

          const fallback = await ensureFallback();

          if (dry) {
            const rendered = renderNotification(event, setting, vars);
            const recipients = resolveNotificationRecipients({
              audience: event.audience,
              configured: setting?.recipients ?? [],
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

          await admin
            .from("showings")
            .update({ [OUTCOME_NUDGE_SENT_COLUMN]: new Date().toISOString() })
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
