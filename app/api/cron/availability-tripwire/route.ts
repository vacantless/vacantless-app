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
  classifyTripwire,
  countOpenBookableSlots,
  openBookableDays,
  shouldAlertTripwire,
} from "@/lib/availability-tripwire";
import { localDateString } from "@/lib/leasing-snapshot";

// Same-day viewing availability tripwire (S513a). Pinged every 15 minutes by
// the shared reminder workflow, but self-gated per org so it is edge-triggered:
// first drop to thin/zero, escalation thin -> zero, then at most once per local
// day while unresolved. Dry mode renders and reports without sending or writing.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const EVENT_KEY = "leasing.viewing_availability_dropped";
const MAX_RECIPIENTS = 10;
const DEFAULT_LOOKAHEAD_DAYS = 7;
const DEFAULT_THIN_SLOTS = 3;
const DAY_MS = 24 * 3_600_000;

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

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

type AvailabilityRuleRow = AvailabilityRule & { created_at: string | null };
type AvailabilityDayOffRow = { day: string; created_at: string | null };
type AvailabilityOverrideRow = AvailabilityOverride & {
  created_at: string | null;
};
type FutureShowingRow = {
  scheduled_at: string | null;
};

function ownerAdminEmails(members: NotifyMember[]): string[] {
  return members
    .filter((m) => m.role === "owner_admin")
    .map((m) => m.email)
    .filter((email): email is string => typeof email === "string" && email.trim() !== "");
}

async function loadMembers(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orgId: string,
): Promise<NotifyMember[]> {
  const { data: memberRows } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", orgId);
  const members: NotifyMember[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    members.push({ role: m.role, email: u?.user?.email ?? null });
  }
  return members;
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
        "availability_tripwire_enabled, availability_tripwire_lookahead_days, " +
        "availability_tripwire_thin_slots, availability_tripwire_last_state, " +
        "availability_tripwire_last_alert_on",
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
      if (!org.availability_tripwire_enabled) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: "disabled" });
        continue;
      }

      const tz: string = org.booking_timezone || "America/Toronto";
      const lookaheadDays = positiveInt(
        org.availability_tripwire_lookahead_days,
        DEFAULT_LOOKAHEAD_DAYS,
      );
      const thinSlots = positiveInt(
        org.availability_tripwire_thin_slots,
        DEFAULT_THIN_SLOTS,
      );
      const endIso = new Date(nowMs + lookaheadDays * DAY_MS).toISOString();

      const [
        { data: ruleRows, error: ruleErr },
        { data: dayOffRows, error: dayOffErr },
        { data: overrideRows, error: overrideErr },
        { data: futureShowingRows, error: futureShowingErr },
      ] = await Promise.all([
        admin
          .from("availability_rules")
          .select("weekday, start_minute, end_minute, created_at")
          .eq("organization_id", org.id),
        admin
          .from("availability_days_off")
          .select("day, created_at")
          .eq("organization_id", org.id),
        admin
          .from("availability_overrides")
          .select("day, start_minute, end_minute, created_at")
          .eq("organization_id", org.id),
        admin
          .from("showings")
          .select("scheduled_at")
          .eq("organization_id", org.id)
          .gte("scheduled_at", now.toISOString())
          .lt("scheduled_at", endIso)
          .or("outcome.is.null,outcome.eq.scheduled")
          .order("scheduled_at", { ascending: true }),
      ]);
      if (ruleErr) throw new Error(`rules:${ruleErr.message}`);
      if (dayOffErr) throw new Error(`days_off:${dayOffErr.message}`);
      if (overrideErr) throw new Error(`overrides:${overrideErr.message}`);
      if (futureShowingErr) {
        throw new Error(`future_showings:${futureShowingErr.message}`);
      }

      const rules = (ruleRows ?? []) as AvailabilityRuleRow[];
      const daysOff = (dayOffRows ?? []) as AvailabilityDayOffRow[];
      const overrides = (overrideRows ?? []) as AvailabilityOverrideRow[];
      const booked = ((futureShowingRows ?? []) as FutureShowingRow[])
        .map((r) => r.scheduled_at)
        .filter((iso): iso is string => typeof iso === "string" && iso !== "")
        .sort();
      const availability: Availability = {
        timezone: tz,
        slot_minutes: positiveInt(org.booking_slot_minutes, 30),
        lead_hours:
          typeof org.booking_lead_hours === "number" &&
          Number.isFinite(org.booking_lead_hours) &&
          org.booking_lead_hours >= 0
            ? org.booking_lead_hours
            : 12,
        horizon_days: positiveInt(org.booking_horizon_days, 14),
        rules: rules.map((r) => ({
          weekday: r.weekday,
          start_minute: r.start_minute,
          end_minute: r.end_minute,
        })),
        booked,
        days_off: daysOff.map((r) => String(r.day)),
        overrides: overrides.map((r) => ({
          day: String(r.day),
          start_minute: r.start_minute,
          end_minute: r.end_minute,
        })),
      };

      const open = countOpenBookableSlots(availability, now, lookaheadDays);
      const openDayKeys = openBookableDays(availability, now, lookaheadDays);
      const openDays = openDayKeys.length;
      const severity = classifyTripwire({ open, openDays, thinSlots });
      const todayLocal = localDateString(nowMs, tz);
      const decision = shouldAlertTripwire({
        severity,
        lastState: org.availability_tripwire_last_state ?? null,
        lastAlertOn: org.availability_tripwire_last_alert_on ?? null,
        todayLocal,
      });
      const alert = force || decision.alert;

      const viewingTimesUrl = `${APP_URL}/dashboard/availability`;
      const vars: Record<string, string> = {
        org_name: org.name ?? "",
        property_address: "",
        open_slots: String(open),
        open_days: String(openDays),
        window_days: String(lookaheadDays),
        viewing_times_url: viewingTimesUrl,
      };

      if (dry || alert) {
        const members = await loadMembers(admin, org.id);
        const operatorFallback = resolveLeadNotifyEmails(members, [
          org.reply_to_email,
          org.public_contact_email,
        ]).slice(0, MAX_RECIPIENTS);
        const alwaysInclude = ownerAdminEmails(members);

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
            alwaysInclude,
          });
          const wouldSend = alert && isEventEnabled(setting) && recipients.length > 0;
          if (wouldSend) summary.sent++;
          else summary.skipped++;
          summary.details.push({
            org: org.id,
            dry: true,
            force,
            severity,
            open,
            open_days: openDays,
            open_day_keys: openDayKeys,
            window_days: lookaheadDays,
            thin_slots: thinSlots,
            would_send: wouldSend,
            enabled: isEventEnabled(setting),
            recipients,
            last_state: org.availability_tripwire_last_state ?? null,
            last_alert_on: org.availability_tripwire_last_alert_on ?? null,
            next_last_state: decision.nextLastState,
            next_last_alert_on: decision.nextLastAlertOn,
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
          alwaysInclude,
          action: { label: "Set your viewing times", url: viewingTimesUrl },
        });

        const { error: updateErr } = await admin
          .from("organizations")
          .update({
            availability_tripwire_last_state: decision.nextLastState,
            availability_tripwire_last_alert_on: decision.nextLastAlertOn,
          })
          .eq("id", org.id);
        if (updateErr) throw new Error(`state_update:${updateErr.message}`);

        summary.sent++;
        summary.details.push({
          org: org.id,
          sent: true,
          force,
          severity,
          open,
          open_days: openDays,
          open_day_keys: openDayKeys,
          delivered: result.delivered,
          sent_count: result.sentCount,
          attempted: result.attempted,
          skipped_by_substrate: result.skipped ?? null,
          stamped_state: decision.nextLastState,
          stamped_alert_on: decision.nextLastAlertOn,
        });
        continue;
      }

      const { error: updateErr } = await admin
        .from("organizations")
        .update({
          availability_tripwire_last_state: decision.nextLastState,
          availability_tripwire_last_alert_on: decision.nextLastAlertOn,
        })
        .eq("id", org.id);
      if (updateErr) throw new Error(`state_update:${updateErr.message}`);

      summary.skipped++;
      summary.details.push({
        org: org.id,
        skipped: severity === "ok" ? "ok" : "debounced",
        severity,
        open,
        open_days: openDays,
        open_day_keys: openDayKeys,
        stamped_state: decision.nextLastState,
        stamped_alert_on: decision.nextLastAlertOn,
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
