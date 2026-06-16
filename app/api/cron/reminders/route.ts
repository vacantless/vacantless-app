import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendShowingReminder } from "@/lib/email";
import { sendSms, showingReminderSms } from "@/lib/sms";
import { formatSlotLong } from "@/lib/booking";
import { reminderDue, REMINDER_SENT_COLUMN, type ReminderKind } from "@/lib/reminders";

// Reminder sweep. Finds booked showings that are ~24h or ~2h out and haven't
// had that reminder sent yet, then sends a branded EMAIL reminder and — when the
// org has SMS on and we have a usable, non-opted-out number — a parallel SMS
// reminder. Email and SMS are tracked on SEPARATE stamp columns so each sends
// (and never double-sends) on its own track; one failing never blocks the other.
//
// Idempotent + catch-up safe: re-runs never double-send (the stamped column
// gates each kind/channel).
//
// Auth: gated by CRON_SECRET. Vercel Cron sends `Authorization: Bearer
// <CRON_SECRET>` automatically; an external pinger can send the same header or
// pass ?secret=<CRON_SECRET>. If CRON_SECRET is unset the route refuses to run.
//
// Reads upcoming showings across all orgs via the service-role client (RLS
// hides them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REMINDER_SMS_SENT_COLUMN: Record<ReminderKind, string> = {
  "24h": "reminder_24h_sms_sent_at",
  "2h": "reminder_2h_sms_sent_at",
};

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number; // emails sent
  smsSent: number; // texts sent
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured → refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const qp = req.nextUrl.searchParams.get("secret");
  return qp === secret;
}

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

  const now = new Date();
  const nowMs = now.getTime();
  const in24hIso = new Date(nowMs + 24 * 3_600_000).toISOString();

  // Pull soon-upcoming scheduled showings that still have at least one reminder
  // (email OR sms) unsent, with the lead/property/org data we need.
  const { data, error } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, reminder_24h_sent_at, reminder_2h_sent_at, " +
        "reminder_24h_sms_sent_at, reminder_2h_sms_sent_at, organization_id, lead_id, " +
        "leads(name, email, phone, sms_opt_out), properties(address), " +
        "organizations(name, brand_color, logo_url, reply_to_email, booking_timezone, sms_enabled)",
    )
    .eq("outcome", "scheduled")
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", in24hIso)
    .or(
      "reminder_24h_sent_at.is.null,reminder_2h_sent_at.is.null," +
        "reminder_24h_sms_sent_at.is.null,reminder_2h_sms_sent_at.is.null",
    );

  if (error) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${error.message}`, scanned: 0, sent: 0, smsSent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const rows = data ?? [];
  const summary: Summary = { ok: true, scanned: rows.length, sent: 0, smsSent: 0, skipped: 0, errors: 0, details: [] };

  for (const row of rows as any[]) {
   // Per-row isolation (audit C2): a thrown PostgREST/network error inside one
   // row must not abort the sweep for the remaining (timing-sensitive) rows.
   try {
    const scheduledAt: string | null = row.scheduled_at;
    if (!scheduledAt) {
      summary.skipped++;
      continue;
    }
    const scheduledAtMs = new Date(scheduledAt).getTime();

    // Supabase returns to-one relations as an object (or array on some shapes).
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

    const tz: string = org?.booking_timezone || "America/Toronto";
    const whenLabel = formatSlotLong(scheduledAt, tz);
    const orgName: string | null = org?.name ?? null;
    const addr: string | null = property?.address ?? null;

    let didSomething = false;

    // --- Email reminder (own stamp track) ---------------------------------
    const emailKind: ReminderKind | null = reminderDue({
      scheduledAtMs,
      nowMs,
      sent24h: row.reminder_24h_sent_at != null,
      sent2h: row.reminder_2h_sent_at != null,
    });
    const renterEmail: string | null = lead?.email ?? null;
    if (emailKind && renterEmail) {
      const result = await sendShowingReminder({
        lead_id: row.lead_id,
        kind: emailKind,
        renter_name: lead?.name ?? null,
        renter_email: renterEmail,
        org_name: orgName,
        brand_color: org?.brand_color ?? null,
        logo_url: org?.logo_url ?? null,
        reply_to_email: org?.reply_to_email ?? null,
        property_address: addr,
        when_label: whenLabel,
      });

      if (!result.sent) {
        summary.errors++;
        summary.details.push({ showing: row.id, channel: "email", kind: emailKind, error: result.reason });
      } else {
        const column = REMINDER_SENT_COLUMN[emailKind];
        const { error: stampErr } = await admin
          .from("showings")
          .update({ [column]: new Date().toISOString() })
          .eq("id", row.id);
        if (stampErr) {
          summary.errors++;
          summary.details.push({ showing: row.id, channel: "email", kind: emailKind, error: `stamp_failed:${stampErr.message}` });
        } else {
          await admin.from("messages").insert({
            organization_id: row.organization_id,
            lead_id: row.lead_id,
            channel: "email",
            direction: "outbound",
            body: `${emailKind === "2h" ? "2-hour" : "24-hour"} showing reminder sent to ${renterEmail}` +
              (result.subject ? ` — "${result.subject}"` : ""),
          });
          summary.sent++;
          didSomething = true;
          summary.details.push({ showing: row.id, channel: "email", kind: emailKind, to: renterEmail });
        }
      }
    }

    // --- SMS reminder (own stamp track; independent of email) -------------
    const smsKind: ReminderKind | null = reminderDue({
      scheduledAtMs,
      nowMs,
      sent24h: row.reminder_24h_sms_sent_at != null,
      sent2h: row.reminder_2h_sms_sent_at != null,
    });
    const phone: string | null = lead?.phone ?? null;
    const smsEnabled: boolean = org?.sms_enabled === true;
    const optedOut: boolean = lead?.sms_opt_out === true;
    if (smsKind && smsEnabled && phone && !optedOut) {
      const result = await sendSms({
        to: phone,
        body: showingReminderSms({ org_name: orgName, property_address: addr, when_label: whenLabel }, smsKind),
      });

      if (!result.sent) {
        // "no_credentials" is expected until Twilio is configured — not an
        // error worth alarming on; everything else is logged.
        if (result.reason !== "no_credentials") {
          summary.errors++;
          summary.details.push({ showing: row.id, channel: "sms", kind: smsKind, error: result.reason });
        }
      } else {
        const column = REMINDER_SMS_SENT_COLUMN[smsKind];
        const { error: stampErr } = await admin
          .from("showings")
          .update({ [column]: new Date().toISOString() })
          .eq("id", row.id);
        if (stampErr) {
          summary.errors++;
          summary.details.push({ showing: row.id, channel: "sms", kind: smsKind, error: `stamp_failed:${stampErr.message}` });
        } else {
          await admin.from("messages").insert({
            organization_id: row.organization_id,
            lead_id: row.lead_id,
            channel: "sms",
            direction: "outbound",
            body: `${smsKind === "2h" ? "2-hour" : "24-hour"} showing reminder text sent to ${phone}`,
          });
          summary.smsSent++;
          didSomething = true;
          summary.details.push({ showing: row.id, channel: "sms", kind: smsKind, to: phone });
        }
      }
    }

    if (!didSomething) summary.skipped++;
   } catch (err) {
     summary.errors++;
     summary.details.push({
       showing: (row as any)?.id,
       error: `row_threw:${err instanceof Error ? err.message : "unknown"}`,
     });
   }
  }

  return NextResponse.json(summary, { status: 200 });
}
