import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isEventEnabled,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import type {
  Availability,
  AvailabilityOverride,
  AvailabilityRule,
} from "@/lib/booking";
import {
  isViewingWeekEmpty,
  openViewingDaysNext7,
  shouldSendViewingReminder,
} from "@/lib/viewing-reminder";

// Weekly viewing-times reminder sweep. Modeled on leasing-snapshot: CRON_SECRET
// auth, per-org self-gating with organizations.viewing_reminder_last_sent_on,
// notification_settings for copy/recipients/on-off, and operator fallback
// recipients. Difference: it only emails when the coming week has no bookable
// viewing times; covered calendars are stamped and stay quiet.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.viewing_availability_reminder";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

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
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, " +
        "booking_timezone, booking_slot_minutes, booking_lead_hours, booking_horizon_days, " +
        "viewing_reminder_enabled, viewing_reminder_weekday, viewing_reminder_hour, viewing_reminder_last_sent_on",
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
  const now = new Date(nowMs);
  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    try {
      if (!org.viewing_reminder_enabled) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: "disabled" });
        continue;
      }

      const tz: string = org.booking_timezone || "America/Toronto";
      const gate = shouldSendViewingReminder({
        nowMs,
        tz,
        weekday: num(org.viewing_reminder_weekday, 0),
        hour: num(org.viewing_reminder_hour, 17),
        lastSentOn: org.viewing_reminder_last_sent_on ?? null,
      });
      if (!force && !dry && !gate.send) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: gate.reason });
        continue;
      }

      const [
        { data: ruleRows, error: ruleErr },
        { data: dayOffRows, error: dayOffErr },
        { data: overrideRows, error: overrideErr },
      ] = await Promise.all([
        admin
          .from("availability_rules")
          .select("weekday, start_minute, end_minute")
          .eq("organization_id", org.id),
        admin
          .from("availability_days_off")
          .select("day")
          .eq("organization_id", org.id),
        admin
          .from("availability_overrides")
          .select("day, start_minute, end_minute")
          .eq("organization_id", org.id),
      ]);
      if (ruleErr) throw new Error(`rules:${ruleErr.message}`);
      if (dayOffErr) throw new Error(`days_off:${dayOffErr.message}`);
      if (overrideErr) throw new Error(`overrides:${overrideErr.message}`);

      const availability: Availability = {
        timezone: tz,
        slot_minutes: num(org.booking_slot_minutes, 30),
        lead_hours: num(org.booking_lead_hours, 12),
        horizon_days: num(org.booking_horizon_days, 14),
        rules: (ruleRows ?? []) as AvailabilityRule[],
        booked: [],
        days_off: ((dayOffRows ?? []) as { day: string }[]).map((r) => r.day),
        overrides: (overrideRows ?? []) as AvailabilityOverride[],
      };

      const openDays = openViewingDaysNext7(availability, now);
      const empty = isViewingWeekEmpty(availability, now);

      if (!empty) {
        if (!dry) {
          await admin
            .from("organizations")
            .update({ viewing_reminder_last_sent_on: gate.localDate })
            .eq("id", org.id);
        }
        summary.skipped++;
        summary.details.push({
          org: org.id,
          dry,
          skipped: "covered",
          open_days_next_7: openDays.length,
          open_days: openDays,
          stamped: dry ? null : gate.localDate,
        });
        continue;
      }

      const { data: memberRows } = await admin
        .from("memberships")
        .select("user_id, role")
        .eq("organization_id", org.id);
      const members: NotifyMember[] = [];
      for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        members.push({ role: m.role, email: u?.user?.email ?? null });
      }
      const operatorFallback = resolveLeadNotifyEmails(members, [
        org.reply_to_email,
        org.public_contact_email,
      ]).slice(0, MAX_RECIPIENTS);

      const viewingTimesUrl = `${APP_URL}/dashboard/availability`;
      const vars: Record<string, string> = {
        org_name: org.name ?? "",
        property_address: "",
        open_days_next_7: String(openDays.length),
        viewing_times_url: viewingTimesUrl,
      };

      if (dry) {
        const { data: settingRow } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", EVENT_KEY)
          .maybeSingle();
        const setting = (settingRow as NotificationSettingRow | null) ?? null;
        const rendered = renderNotification(event, setting, vars);
        const recipients = resolveNotificationRecipients({
          audience: event.audience,
          configured: setting?.recipients ?? [],
          operatorFallback,
        });
        const wouldSend = isEventEnabled(setting) && recipients.length > 0;
        if (wouldSend) summary.sent++;
        else summary.skipped++;
        summary.details.push({
          org: org.id,
          dry: true,
          empty: true,
          would_send: wouldSend,
          enabled: isEventEnabled(setting),
          recipients,
          open_days_next_7: openDays.length,
          subject: rendered.subject,
          body: rendered.body,
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
        operatorFallback,
        action: { label: "Set your viewing times", url: viewingTimesUrl },
      });

      await admin
        .from("organizations")
        .update({ viewing_reminder_last_sent_on: gate.localDate })
        .eq("id", org.id);

      summary.sent++;
      summary.details.push({
        org: org.id,
        sent: true,
        delivered: result.delivered,
        sent_count: result.sentCount,
        attempted: result.attempted,
        skipped_by_substrate: result.skipped ?? null,
        open_days_next_7: openDays.length,
        stamped: gate.localDate,
      });
    } catch (err) {
      summary.errors++;
      summary.details.push({
        org: (org as any)?.id,
        error: `org_threw:${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
