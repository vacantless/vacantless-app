import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendShowingReminder } from "@/lib/email";
import { formatSlotLong } from "@/lib/booking";
import { reminderDue, REMINDER_SENT_COLUMN, type ReminderKind } from "@/lib/reminders";

// Reminder sweep. Finds booked showings that are ~24h or ~2h out and haven't
// had that reminder sent yet, emails a branded reminder, then stamps the
// sent-at column + logs the lead timeline. Idempotent + catch-up safe: re-runs
// never double-send (the stamped column gates each kind).
//
// Auth: gated by CRON_SECRET. Vercel Cron sends `Authorization: Bearer
// <CRON_SECRET>` automatically; an external pinger can send the same header or
// pass ?secret=<CRON_SECRET>. If CRON_SECRET is unset the route refuses to run
// (so it can't be triggered before it's configured).
//
// Reads upcoming showings across all orgs via the service-role client (RLS
// hides them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const now = new Date();
  const nowMs = now.getTime();
  const in24hIso = new Date(nowMs + 24 * 3_600_000).toISOString();

  // Pull the small set of soon-upcoming scheduled showings that still have at
  // least one reminder unsent, with the lead/property/org data we need.
  const { data, error } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, reminder_24h_sent_at, reminder_2h_sent_at, organization_id, lead_id, " +
        "leads(name, email), properties(address), organizations(name, brand_color, logo_url, reply_to_email, booking_timezone)",
    )
    .eq("outcome", "scheduled")
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", in24hIso)
    .or("reminder_24h_sent_at.is.null,reminder_2h_sent_at.is.null");

  if (error) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${error.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const rows = data ?? [];
  const summary: Summary = { ok: true, scanned: rows.length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const row of rows as any[]) {
    const scheduledAt: string | null = row.scheduled_at;
    if (!scheduledAt) {
      summary.skipped++;
      continue;
    }

    const kind: ReminderKind | null = reminderDue({
      scheduledAtMs: new Date(scheduledAt).getTime(),
      nowMs,
      sent24h: row.reminder_24h_sent_at != null,
      sent2h: row.reminder_2h_sent_at != null,
    });

    if (!kind) {
      summary.skipped++;
      continue;
    }

    // Supabase returns to-one relations as an object (or array on some shapes).
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

    const renterEmail: string | null = lead?.email ?? null;
    if (!renterEmail) {
      summary.skipped++;
      summary.details.push({ showing: row.id, kind, skipped: "no_email" });
      continue;
    }

    const tz: string = org?.booking_timezone || "America/Toronto";
    const whenLabel = formatSlotLong(scheduledAt, tz);

    const result = await sendShowingReminder({
      lead_id: row.lead_id,
      kind,
      renter_name: lead?.name ?? null,
      renter_email: renterEmail,
      org_name: org?.name ?? null,
      brand_color: org?.brand_color ?? null,
      logo_url: org?.logo_url ?? null,
      reply_to_email: org?.reply_to_email ?? null,
      property_address: property?.address ?? null,
      when_label: whenLabel,
    });

    if (!result.sent) {
      summary.errors++;
      summary.details.push({ showing: row.id, kind, error: result.reason });
      continue;
    }

    // Stamp the sent-at column so this kind never re-sends, then log timeline.
    const column = REMINDER_SENT_COLUMN[kind];
    const { error: stampErr } = await admin
      .from("showings")
      .update({ [column]: new Date().toISOString() })
      .eq("id", row.id);

    if (stampErr) {
      // The email went out but we couldn't stamp — surface it; the next run may
      // re-send. Rare; logged so it's visible.
      summary.errors++;
      summary.details.push({ showing: row.id, kind, error: `stamp_failed:${stampErr.message}` });
      continue;
    }

    await admin.from("messages").insert({
      organization_id: row.organization_id,
      lead_id: row.lead_id,
      channel: "email",
      direction: "outbound",
      body: `${kind === "2h" ? "2-hour" : "24-hour"} showing reminder sent to ${renterEmail}` +
        (result.subject ? ` — "${result.subject}"` : ""),
    });

    summary.sent++;
    summary.details.push({ showing: row.id, kind, to: renterEmail });
  }

  return NextResponse.json(summary, { status: 200 });
}
