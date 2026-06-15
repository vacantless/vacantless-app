import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFeedbackRequest } from "@/lib/email";
import { feedbackDue, FEEDBACK_MAX_AGE_HOURS, HOUR_MS } from "@/lib/feedback";

// Post-showing feedback sweep (M5). Finds attended showings whose feedback
// request hasn't gone out yet and whose org has feedback collection enabled,
// waits the org's configured delay after the showing, then emails a branded
// feedback request, stamps showings.feedback_request_sent_at, and logs the
// lead timeline. Idempotent + catch-up safe: the stamped column gates each
// showing so re-runs never double-send.
//
// Auth + transport mirror app/api/cron/reminders: CRON_SECRET-gated; driven by
// the same GitHub Actions pinger (every 15 min) since feedback timeliness
// (default 2h delay) doesn't need Vercel Pro sub-daily cron.
//
// Reads attended showings across all orgs via the service-role client (RLS
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
  // Only consider showings recent enough to still be worth asking about.
  const oldestIso = new Date(nowMs - FEEDBACK_MAX_AGE_HOURS * HOUR_MS).toISOString();

  const { data, error } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, organization_id, lead_id, " +
        "leads(name, email), properties(address), " +
        "organizations(name, brand_color, logo_url, reply_to_email, feedback_enabled, feedback_delay_hours)",
    )
    .eq("outcome", "attended")
    .is("feedback_request_sent_at", null)
    .lt("scheduled_at", now.toISOString())
    .gt("scheduled_at", oldestIso);

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

    // Supabase returns to-one relations as an object (or array on some shapes).
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

    const due = feedbackDue({
      scheduledAtMs: scheduledAt ? new Date(scheduledAt).getTime() : null,
      nowMs,
      outcome: "attended",
      requestSent: false,
      delayHours: org?.feedback_delay_hours ?? 2,
      enabled: org?.feedback_enabled ?? true,
    });

    if (!due) {
      summary.skipped++;
      continue;
    }

    const renterEmail: string | null = lead?.email ?? null;
    if (!renterEmail) {
      summary.skipped++;
      summary.details.push({ showing: row.id, skipped: "no_email" });
      continue;
    }

    const result = await sendFeedbackRequest({
      lead_id: row.lead_id,
      showing_id: row.id,
      renter_name: lead?.name ?? null,
      renter_email: renterEmail,
      org_name: org?.name ?? null,
      brand_color: org?.brand_color ?? null,
      logo_url: org?.logo_url ?? null,
      reply_to_email: org?.reply_to_email ?? null,
      property_address: property?.address ?? null,
    });

    if (!result.sent) {
      summary.errors++;
      summary.details.push({ showing: row.id, error: result.reason });
      continue;
    }

    // Stamp so this showing never re-sends, then log the timeline.
    const { error: stampErr } = await admin
      .from("showings")
      .update({ feedback_request_sent_at: new Date().toISOString() })
      .eq("id", row.id);

    if (stampErr) {
      // The email went out but we couldn't stamp — surface it; a later run may
      // re-send. Rare; logged so it's visible.
      summary.errors++;
      summary.details.push({ showing: row.id, error: `stamp_failed:${stampErr.message}` });
      continue;
    }

    if (row.lead_id) {
      await admin.from("messages").insert({
        organization_id: row.organization_id,
        lead_id: row.lead_id,
        channel: "email",
        direction: "outbound",
        body: `Feedback request sent to ${renterEmail}` +
          (result.subject ? ` — "${result.subject}"` : ""),
      });
    }

    summary.sent++;
    summary.details.push({ showing: row.id, to: renterEmail });
  }

  return NextResponse.json(summary, { status: 200 });
}
