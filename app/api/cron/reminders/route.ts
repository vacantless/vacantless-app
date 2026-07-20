import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendShowingReminder } from "@/lib/email";
import { normalizePhoneE164, sendSms, showingReminderSms, smsLive } from "@/lib/sms";
import { formatSlotLong } from "@/lib/booking";
import {
  channelPlan,
  autoReleaseDue,
  pendingRescheduleShowingIds,
  reminderDue,
  REMINDER_SMS_SENT_COLUMN,
  REMINDER_SENT_COLUMN,
  type PendingRescheduleProposalRow,
} from "@/lib/reminders";
import { canUseRenterSms } from "@/lib/billing";
import { releaseUnconfirmedShowing } from "@/lib/showing-release";
import { resolveArrivalPhone } from "@/lib/showing-contact";

// Reminder sweep. Finds booked showings that are ~24h, same-day, or optionally
// ~2h out and haven't had that tier sent yet, then sends exactly one coordinated
// channel for that tier: email for the day-ahead touch, SMS for the same-day
// touch when deliverable, and email fallback for same-day when SMS cannot go.
// Email and SMS still stamp SEPARATE columns for audit/idempotency, but channel
// planning prevents a same-tier double ping.
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

const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app"
).replace(/\/+$/, "");

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number; // emails sent
  smsSent: number; // texts sent
  released: number; // unconfirmed viewings released by S522
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

type ReminderLead = {
  id?: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  sms_opt_out: boolean | null;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured → refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const qp = req.nextUrl.searchParams.get("secret");
  return qp === secret;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function embeddedLead(row: any): ReminderLead | null {
  return one<ReminderLead>(row?.leads);
}

function reminderLeadFor(row: any, fallbacks: Map<string, ReminderLead>): ReminderLead | null {
  const embedded = embeddedLead(row);
  if (textOrNull(embedded?.email)) return embedded;
  const leadId = textOrNull(row?.lead_id);
  return (leadId ? fallbacks.get(leadId) : null) ?? embedded ?? null;
}

async function loadMissingReminderLeads(
  admin: any,
  rows: any[],
): Promise<{ leadsById: Map<string, ReminderLead>; error?: string }> {
  const leadsById = new Map<string, ReminderLead>();
  const missingLeadIds = Array.from(
    new Set(
      rows
        .filter((row) => !textOrNull(embeddedLead(row)?.email))
        .map((row) => textOrNull(row?.lead_id))
        .filter((id): id is string => id != null),
    ),
  );
  if (missingLeadIds.length === 0) {
    return { leadsById };
  }

  const { data, error } = await admin
    .from("leads")
    .select("id, name, email, phone, sms_opt_out")
    .in("id", missingLeadIds);
  if (error) {
    return { leadsById, error: error.message };
  }

  for (const row of (data ?? []) as ReminderLead[]) {
    const id = textOrNull(row.id);
    if (id) leadsById.set(id, row);
  }
  return { leadsById };
}

function skippedDetail(input: {
  row: any;
  reason: string;
  kind: string | null;
  renterEmail: string | null;
  plan: { email: boolean; sms: boolean };
}) {
  return {
    showing: input.row?.id,
    reason: input.reason,
    kind: input.kind,
    hasEmail: input.renterEmail != null,
    planEmail: input.plan.email,
    planSms: input.plan.sms,
  };
}

function respondSummary(summary: Summary) {
  console.log("[reminders-cron]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: 200 });
}

async function runAutoReleasePass(
  admin: any,
  now: Date,
): Promise<{ released: number; errors: number; details: Array<Record<string, unknown>> }> {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const maxReleaseIso = new Date(nowMs + 24 * 3_600_000).toISOString();
  const details: Array<Record<string, unknown>> = [];
  let released = 0;
  let errors = 0;

  const { data, error } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, outcome, confirmed_at, organization_id, " +
        "organizations!inner(id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone, showing_confirm_mode, auto_release_unconfirmed_enabled, auto_release_unconfirmed_hours)",
    )
    .eq("outcome", "scheduled")
    .is("confirmed_at", null)
    .gt("scheduled_at", nowIso)
    .lte("scheduled_at", maxReleaseIso)
    .eq("organizations.showing_confirm_mode", "agent")
    .eq("organizations.auto_release_unconfirmed_enabled", true);
  if (error) {
    return {
      released: 0,
      errors: 1,
      details: [{ auto_release: false, error: `query_error:${error.message}` }],
    };
  }

  for (const row of (data ?? []) as any[]) {
    try {
      const org = one<{
        id: string;
        name: string | null;
        brand_color: string | null;
        logo_url: string | null;
        reply_to_email: string | null;
        public_contact_email: string | null;
        booking_timezone: string | null;
        showing_confirm_mode: string | null;
        auto_release_unconfirmed_enabled: boolean | null;
        auto_release_unconfirmed_hours: number | null;
      }>(row.organizations);
      if (!org || !row.scheduled_at) {
        continue;
      }
      const hours =
        typeof org.auto_release_unconfirmed_hours === "number"
          ? org.auto_release_unconfirmed_hours
          : 2;
      const due = autoReleaseDue({
        scheduledAtMs: new Date(row.scheduled_at).getTime(),
        nowMs,
        mode: org.showing_confirm_mode,
        enabled: org.auto_release_unconfirmed_enabled === true,
        hoursBefore: hours,
        confirmed: row.confirmed_at != null,
        outcome: row.outcome,
      });
      if (!due) {
        continue;
      }

      const result = await releaseUnconfirmedShowing(admin, {
        org,
        showingId: row.id,
        appUrl: APP_BASE_URL,
        nowIso,
        noteBody: `Viewing auto-released ${hours} hour${hours === 1 ? "" : "s"} before start because it was still unconfirmed.`,
      });
      if (result.released) {
        released++;
        details.push({ auto_release: true, showing: row.id, org: org.id, hours });
      } else {
        details.push({
          auto_release: false,
          showing: row.id,
          org: org.id,
          reason: result.reason,
        });
      }
    } catch (err) {
      errors++;
      details.push({
        auto_release: false,
        showing: row?.id,
        error: `row_threw:${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return { released, errors, details };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return respondSummary({
      ok: false,
      reason: "service_role_not_configured",
      scanned: 0,
      sent: 0,
      smsSent: 0,
      released: 0,
      skipped: 0,
      errors: 0,
      details: [],
    } satisfies Summary);
  }

  const now = new Date();
  const nowMs = now.getTime();
  const in24hIso = new Date(nowMs + 24 * 3_600_000).toISOString();
  const autoRelease = await runAutoReleasePass(admin, now);

  // Pull soon-upcoming scheduled showings that still have at least one reminder
  // (email OR sms) unsent, with the lead/property/org data we need.
  const { data, error } = await admin
    .from("showings")
    .select(
      "id, cancel_token, scheduled_at, reminder_24h_sent_at, reminder_sameday_sent_at, reminder_2h_sent_at, " +
        "reminder_24h_sms_sent_at, reminder_sameday_sms_sent_at, reminder_2h_sms_sent_at, organization_id, lead_id, " +
        "leads:leads!showings_lead_id_fkey(name, email, phone, sms_opt_out), properties(address, showing_arrival_phone), " +
        "organizations(name, brand_color, logo_url, reply_to_email, booking_timezone, sms_enabled, plan, showing_arrival_phone, public_contact_phone)",
    )
    .eq("outcome", "scheduled")
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", in24hIso)
    .or(
      "reminder_24h_sent_at.is.null,reminder_sameday_sent_at.is.null,reminder_2h_sent_at.is.null," +
        "reminder_24h_sms_sent_at.is.null,reminder_sameday_sms_sent_at.is.null,reminder_2h_sms_sent_at.is.null",
    );

  if (error) {
    return respondSummary({
      ok: false,
      reason: `query_error:${error.message}`,
      scanned: 0,
      sent: 0,
      smsSent: 0,
      released: autoRelease.released,
      skipped: 0,
      errors: 1 + autoRelease.errors,
      details: autoRelease.details,
    } satisfies Summary);
  }

  const candidateRows = data ?? [];
  const candidateIds = (candidateRows as any[])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  let rows = candidateRows;
  if (candidateIds.length > 0) {
    const { data: proposalRows, error: proposalErr } = await admin
      .from("showing_reschedule_proposals")
      .select("showing_id, status, responded_at")
      .in("showing_id", candidateIds)
      .eq("status", "pending")
      .is("responded_at", null);
    if (proposalErr) {
      return respondSummary({
        ok: false,
        reason: `query_error:${proposalErr.message}`,
        scanned: 0,
        sent: 0,
        smsSent: 0,
        released: autoRelease.released,
        skipped: 0,
        errors: 1 + autoRelease.errors,
        details: autoRelease.details,
      } satisfies Summary);
    }
    const pendingRescheduleIds = pendingRescheduleShowingIds(
      (proposalRows ?? []) as PendingRescheduleProposalRow[],
    );
    rows = (candidateRows as any[]).filter(
      (row) => !pendingRescheduleIds.has(row.id),
    );
  }
  const summary: Summary = {
    ok: true,
    scanned: rows.length,
    sent: 0,
    smsSent: 0,
    released: autoRelease.released,
    skipped: 0,
    errors: autoRelease.errors,
    details: [...autoRelease.details],
  };

  const fallbackLeads = await loadMissingReminderLeads(admin, rows as any[]);
  if (fallbackLeads.error) {
    summary.ok = false;
    summary.reason = `query_error:lead_fallback:${fallbackLeads.error}`;
    summary.errors++;
    summary.details.push({
      lead_fallback: false,
      error: fallbackLeads.error,
    });
    return respondSummary(summary);
  }
  if (fallbackLeads.leadsById.size > 0) {
    summary.details.push({
      lead_fallback: true,
      resolved: fallbackLeads.leadsById.size,
    });
  }

  for (const row of rows as any[]) {
   // Per-row isolation (audit C2): a thrown PostgREST/network error inside one
   // row must not abort the sweep for the remaining (timing-sensitive) rows.
   try {
    const lead = reminderLeadFor(row, fallbackLeads.leadsById);
    const renterEmail = textOrNull(lead?.email);
    let skippedReason: string | null = null;
    const scheduledAt: string | null = row.scheduled_at;
    if (!scheduledAt) {
      summary.skipped++;
      summary.details.push(
        skippedDetail({
          row,
          reason: "missing_scheduled_at",
          kind: null,
          renterEmail,
          plan: { email: false, sms: false },
        }),
      );
      continue;
    }
    const scheduledAtMs = new Date(scheduledAt).getTime();

    // Supabase returns to-one relations as an object (or array on some shapes).
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

    const tz: string = org?.booking_timezone || "America/Toronto";
    const whenLabel = formatSlotLong(scheduledAt, tz);
    const orgName: string | null = org?.name ?? null;
    const addr: string | null = property?.address ?? null;
    // S471: resolved arrival phone for the reminder logistics.
    const leasingPhone: string | null = resolveArrivalPhone(
      property?.showing_arrival_phone,
      org?.showing_arrival_phone,
      org?.public_contact_phone,
    );

    let didSomething = false;

    const phone: string | null = lead?.phone ?? null;
    const normalizedPhone = normalizePhoneE164(phone);
    // Renter SMS is a paid (Growth+) capability: enforce the plan at the send
    // site, not just the sms_enabled toggle (Codex P2 "Free = no texting").
    const smsEnabled: boolean = org?.sms_enabled === true && canUseRenterSms(org?.plan);
    const optedOut: boolean = lead?.sms_opt_out === true;
    const smsDeliverable = smsEnabled && smsLive() && normalizedPhone != null && !optedOut;

    const kind = reminderDue({
      scheduledAtMs,
      nowMs,
      sent24h: row.reminder_24h_sent_at != null || row.reminder_24h_sms_sent_at != null,
      sentSameday:
        row.reminder_sameday_sent_at != null ||
        row.reminder_sameday_sms_sent_at != null,
      sent2h: row.reminder_2h_sent_at != null || row.reminder_2h_sms_sent_at != null,
    });
    const plan = kind ? channelPlan(kind, { smsDeliverable }) : { email: false, sms: false };
    if (kind && plan.email && !renterEmail) {
      skippedReason = "missing_renter_email";
    } else if (kind && plan.sms && !normalizedPhone) {
      skippedReason = "missing_sms_phone";
    } else if (!kind) {
      skippedReason = "no_due_reminder";
    } else if (!plan.email && !plan.sms) {
      skippedReason = "no_channel_planned";
    }
    const label =
      kind === "2h" ? "2-hour" : kind === "sameday" ? "same-day" : "24-hour";
    const token = typeof row.cancel_token === "string" ? row.cancel_token.trim() : "";
    const confirmUrl = token
      ? `${APP_BASE_URL}/showing/confirm/${encodeURIComponent(token)}`
      : null;
    const rescheduleUrl = token
      ? `${APP_BASE_URL}/showing/reschedule/${encodeURIComponent(token)}`
      : null;
    const cancelUrl = token
      ? `${APP_BASE_URL}/showing/cancel/${encodeURIComponent(token)}`
      : null;

    // --- Coordinated email reminder ---------------------------------------
    if (kind && plan.email && renterEmail) {
      const result = await sendShowingReminder({
        lead_id: row.lead_id,
        showing_id: row.id,
        kind,
        renter_name: lead?.name ?? null,
        renter_email: renterEmail,
        org_name: orgName,
        brand_color: org?.brand_color ?? null,
        logo_url: org?.logo_url ?? null,
        reply_to_email: org?.reply_to_email ?? null,
        property_address: addr,
        leasing_phone: leasingPhone,
        cancel_token: row.cancel_token ?? null,
        when_label: whenLabel,
      });

      if (!result.sent) {
        skippedReason = `email_send_failed:${result.reason ?? "unknown"}`;
        summary.errors++;
        summary.details.push({ showing: row.id, channel: "email", kind, error: result.reason });
      } else {
        const column = REMINDER_SENT_COLUMN[kind];
        const { error: stampErr } = await admin
          .from("showings")
          .update({ [column]: new Date().toISOString() })
          .eq("id", row.id);
        if (stampErr) {
          skippedReason = `email_stamp_failed:${stampErr.message}`;
          summary.errors++;
          summary.details.push({ showing: row.id, channel: "email", kind, error: `stamp_failed:${stampErr.message}` });
        } else {
          await admin.from("messages").insert({
            organization_id: row.organization_id,
            lead_id: row.lead_id,
            channel: "email",
            direction: "outbound",
            body: `${label} viewing reminder sent to ${renterEmail}` +
              (result.subject ? ` — "${result.subject}"` : ""),
          });
          summary.sent++;
          didSomething = true;
          summary.details.push({ showing: row.id, channel: "email", kind, to: renterEmail });
        }
      }
    }

    // --- Coordinated SMS reminder -----------------------------------------
    if (kind && plan.sms && normalizedPhone) {
      const result = await sendSms({
        to: normalizedPhone,
        body: showingReminderSms(
          {
            org_name: orgName,
            property_address: addr,
            when_label: whenLabel,
            confirm_url: confirmUrl,
            reschedule_url: rescheduleUrl,
            cancel_url: cancelUrl,
          },
          kind,
        ),
      });

      if (!result.sent) {
        // "no_credentials" is expected until Twilio is configured — not an
        // error worth alarming on; everything else is logged.
        if (result.reason !== "no_credentials") {
          summary.errors++;
          summary.details.push({ showing: row.id, channel: "sms", kind, error: result.reason });
          skippedReason = `sms_send_failed:${result.reason ?? "unknown"}`;
        } else {
          skippedReason = "sms_send_skipped:no_credentials";
        }
      } else {
        const column = REMINDER_SMS_SENT_COLUMN[kind];
        const { error: stampErr } = await admin
          .from("showings")
          .update({ [column]: new Date().toISOString() })
          .eq("id", row.id);
        if (stampErr) {
          skippedReason = `sms_stamp_failed:${stampErr.message}`;
          summary.errors++;
          summary.details.push({ showing: row.id, channel: "sms", kind, error: `stamp_failed:${stampErr.message}` });
        } else {
          await admin.from("messages").insert({
            organization_id: row.organization_id,
            lead_id: row.lead_id,
            channel: "sms",
            direction: "outbound",
            body: `${label} viewing reminder text sent to ${normalizedPhone}`,
          });
          summary.smsSent++;
          didSomething = true;
          summary.details.push({ showing: row.id, channel: "sms", kind, to: normalizedPhone });
        }
      }
    }

    if (!didSomething) {
      summary.skipped++;
      summary.details.push(
        skippedDetail({
          row,
          reason: skippedReason ?? "no_send_attempt",
          kind,
          renterEmail,
          plan,
        }),
      );
    }
   } catch (err) {
     summary.errors++;
     summary.details.push({
       showing: (row as any)?.id,
       error: `row_threw:${err instanceof Error ? err.message : "unknown"}`,
     });
   }
  }

  return respondSummary(summary);
}
