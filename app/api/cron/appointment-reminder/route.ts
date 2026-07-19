import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { sendSms, repairReminderSms, smsLive } from "@/lib/sms";
import {
  appointmentReminderDue,
  isoDaysBetween,
  APPOINTMENT_REMINDER_SENT_COLUMN,
  APPOINTMENT_REMINDER_SMS_SENT_COLUMN,
  type ApptReminderKind,
} from "@/lib/reminders";
import { zonedWallTimeToUtc } from "@/lib/booking";
import { formatDayWindow } from "@/lib/repair-scheduling";
import { localDateString } from "@/lib/leasing-snapshot";
import { canUseRepairSms } from "@/lib/billing";

// Repair-appointment reminder sweep (S387, Slice 4) — the close-out of the
// repair-scheduling matcher (work_order_appointments, 0095). For each CONFIRMED
// appointment with a chosen date + arrival window, the tenant gets a reminder the
// DAY BEFORE and again the SAME DAY so they're home for the supplier's window —
// the operator stops chasing the tenant by hand.
//
// EMAIL goes through the notification substrate (audience tenant, per-org
// editable template + branding); the SMS leg is sent directly and is gated on the
// Premium `repair_sms` entitlement + the org's SMS master switch. Email + SMS are
// tracked on SEPARATE stamp columns (reminder_{1d,sameday}_sent_at and their
// _sms_ siblings) so each channel sends — and never double-sends — on its own
// track; one failing never blocks the other.
//
// Calendar-day reminders (not hour bands like showings): a repair is an arrival
// WINDOW the tenant plans their whole day around. The pure decision
// (appointmentReminderDue) is catch-up safe — a late/infrequent cron still fires
// exactly one reminder, same-day taking priority over the day-before.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns the "Repair visit reminder" event on in Automations & Templates. Inert
// regardless until an operator confirms an appointment.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-sent stamps (still sends + re-stamps)
//   ?dry=1      build + return what WOULD send, without sending or stamping
//
// Reads appointments across all orgs via the service-role client (RLS hides them
// from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENT_KEY = "leasing.repair_appointment_reminder";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // emails sent (or "would send" in dry mode)
  smsSent: number; // texts sent
  skipped: number; // orgs/appointments not actionable / opt-out
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

/** "YYYY-MM-DD" + n calendar days, UTC-pinned. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** First name for the greeting (fallback: "there"). */
function firstName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "there";
  return n.split(/\s+/)[0] || "there";
}

type ApptRow = {
  id: string;
  organization_id: string;
  chosen_date: string | null;
  chosen_start_minute: number | null;
  chosen_end_minute: number | null;
  reminder_1d_sent_at: string | null;
  reminder_sameday_sent_at: string | null;
  reminder_1d_sms_sent_at: string | null;
  reminder_sameday_sms_sent_at: string | null;
  work_order: {
    title: string | null;
    property: { address: string | null } | null;
    tenancy: {
      id: string;
      tenants: { name: string | null; email: string | null; phone: string | null; is_primary: boolean | null }[] | null;
    } | null;
  } | null;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, smsSent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
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
      { ok: false, reason: "event_not_registered", scanned: 0, sent: 0, smsSent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  let orgQuery = admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, reply_to_email, booking_timezone, sms_enabled, plan");
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, sent: 0, smsSent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, smsSent: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";
      const today = localDateString(nowMs, tz);
      const tomorrow = addDaysIso(today, 1);

      // Opt-in gate (ship dark): only sweep orgs that have explicitly turned the
      // event on. Absent row => isDripEnqueueEnabled false => skip — one cheap
      // read before the appointment scan.
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

      const smsAllowed = org.sms_enabled === true && canUseRepairSms(org.plan) && smsLive();

      // Confirmed appointments for the org whose chosen date is today or tomorrow
      // and that still have at least one reminder (email OR sms) unsent. The
      // per-row decision (in the org tz) does the precise gating.
      const { data: apptRows } = await admin
        .from("work_order_appointments")
        .select(
          "id, organization_id, chosen_date, chosen_start_minute, chosen_end_minute, " +
            "reminder_1d_sent_at, reminder_sameday_sent_at, reminder_1d_sms_sent_at, reminder_sameday_sms_sent_at, " +
            "work_order:work_orders(title, property:properties(address), " +
            "tenancy:tenancies(id, tenants(name, email, phone, is_primary)))",
        )
        .eq("organization_id", org.id)
        .eq("status", "confirmed")
        .not("chosen_date", "is", null)
        .gte("chosen_date", today)
        .lte("chosen_date", tomorrow)
        .or(
          "reminder_1d_sent_at.is.null,reminder_sameday_sent_at.is.null," +
            "reminder_1d_sms_sent_at.is.null,reminder_sameday_sms_sent_at.is.null",
        );

      for (const raw of (apptRows ?? []) as any[]) {
        const row = raw as ApptRow;
        try {
          const date = row.chosen_date;
          const startMin = row.chosen_start_minute;
          const endMin = row.chosen_end_minute;
          if (!date || startMin == null || endMin == null) {
            summary.skipped++;
            continue;
          }

          const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
          const apptStartMs = zonedWallTimeToUtc(y, m, d, startMin, tz).getTime();
          const daysUntilAppt = isoDaysBetween(today, date);
          if (daysUntilAppt == null) {
            summary.skipped++;
            continue;
          }

          const wo = one<NonNullable<ApptRow["work_order"]>>(row.work_order);
          const prop = one<{ address: string | null }>((wo as any)?.property);
          const address = prop?.address?.trim() || "your unit";
          const ten = one<NonNullable<NonNullable<ApptRow["work_order"]>["tenancy"]>>((wo as any)?.tenancy);
          const tenants = ten?.tenants ?? [];
          const primary =
            tenants.find((t) => t.is_primary) ?? tenants.find((t) => (t.email ?? "").trim() || (t.phone ?? "").trim()) ?? tenants[0] ?? null;
          const tenantEmail = (primary?.email ?? "").trim() || null;
          const tenantPhone = (primary?.phone ?? "").trim() || null;
          const tenantName = primary?.name ?? null;
          const jobTitle = (wo?.title ?? "").trim() || "your repair";
          const windowLabel = formatDayWindow({ date, start_minute: startMin, end_minute: endMin });

          // --- Email leg (own stamp track; via the substrate) -----------------
          const emailKind: ApptReminderKind | null = appointmentReminderDue({
            apptStartMs,
            nowMs,
            daysUntilAppt,
            sent1d: !force && row.reminder_1d_sent_at != null,
            sentSameday: !force && row.reminder_sameday_sent_at != null,
          });

          // --- SMS leg (own stamp track; direct + entitlement-gated) ----------
          const smsKind: ApptReminderKind | null = appointmentReminderDue({
            apptStartMs,
            nowMs,
            daysUntilAppt,
            sent1d: !force && row.reminder_1d_sms_sent_at != null,
            sentSameday: !force && row.reminder_sameday_sms_sent_at != null,
          });

          let didSomething = false;

          // Email
          if (emailKind && tenantEmail) {
            const leadWord = emailKind === "sameday" ? "today" : "tomorrow";
            const vars: Record<string, string> = {
              org_name: org.name ?? "",
              property_address: address,
              tenant_first_name: firstName(tenantName),
              job_title: jobTitle,
              appointment_window: windowLabel,
              reminder_lead: leadWord,
            };
            if (dry) {
              summary.sent++;
              summary.details.push({ org: org.id, appt: row.id, channel: "email", kind: emailKind, dry: true, to: tenantEmail, window: windowLabel, vars });
            } else {
              await sendOrgNotification({
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
                audienceEmail: tenantEmail,
              });
              // Stamp regardless of the substrate's send outcome (it short-circuits
              // a disabled event / missing key best-effort); we don't want to rebuild
              // this reminder on every tick for the rest of the day window.
              await admin
                .from("work_order_appointments")
                .update({ [APPOINTMENT_REMINDER_SENT_COLUMN[emailKind]]: new Date().toISOString() })
                .eq("id", row.id);
              summary.sent++;
              didSomething = true;
              summary.details.push({ org: org.id, appt: row.id, channel: "email", kind: emailKind, to: tenantEmail });
            }
          }

          // SMS
          if (smsKind && smsAllowed && tenantPhone) {
            if (dry) {
              summary.smsSent++;
              summary.details.push({ org: org.id, appt: row.id, channel: "sms", kind: smsKind, dry: true, to: tenantPhone });
            } else {
              const result = await sendSms({
                to: tenantPhone,
                body: repairReminderSms(
                  { org_name: org.name ?? null, property_address: address, when_label: windowLabel },
                  smsKind,
                ),
              });
              if (!result.sent) {
                // "no_credentials" is expected until Twilio is configured — not an error.
                if (result.reason !== "no_credentials") {
                  summary.errors++;
                  summary.details.push({ org: org.id, appt: row.id, channel: "sms", kind: smsKind, error: result.reason });
                }
              } else {
                await admin
                  .from("work_order_appointments")
                  .update({ [APPOINTMENT_REMINDER_SMS_SENT_COLUMN[smsKind]]: new Date().toISOString() })
                  .eq("id", row.id);
                summary.smsSent++;
                didSomething = true;
                summary.details.push({ org: org.id, appt: row.id, channel: "sms", kind: smsKind, to: tenantPhone });
              }
            }
          }

          if (!didSomething && !dry) summary.skipped++;
        } catch (e: any) {
          summary.errors++;
          summary.details.push({ org: org.id, appt: row?.id, error: `row_threw:${String(e?.message ?? e)}` });
        }
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
