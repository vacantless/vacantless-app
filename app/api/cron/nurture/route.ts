import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNurtureEmail } from "@/lib/email";
import {
  nurtureStepDue,
  NURTURABLE_STATUSES,
  NURTURE_STEPS,
  NURTURE_MAX_AGE_MS,
} from "@/lib/nurture";

// Lead-nurture sweep (M5). Finds still-open leads (inquired, not yet booked or
// lost) whose org has nurturing enabled and whose next drip step is due, sends
// the one branded follow-up that's currently due, bumps leads.nurture_step_sent
// + leads.nurture_last_sent_at, and logs the lead timeline. Idempotent +
// catch-up safe: only ever sends step (nurture_step_sent + 1), so a re-run
// never double-sends and steps go out strictly in order, one per sweep.
//
// Auth + transport mirror app/api/cron/reminders + app/api/cron/feedback:
// CRON_SECRET-gated; driven by the same GitHub Actions pinger (every 15 min).
//
// Reads leads across all orgs via the service-role client (RLS hides them from
// anon/user sessions); see lib/supabase/admin.ts.

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
  // Only consider leads recent enough to still be worth nurturing (don't drip
  // cold/imported leads when an org first enables the feature).
  const oldestIso = new Date(nowMs - NURTURE_MAX_AGE_MS).toISOString();

  const { data, error } = await admin
    .from("leads")
    .select(
      "id, created_at, organization_id, property_id, name, email, status, " +
        "no_suitable_time, nurture_step_sent, nurture_last_sent_at, " +
        "properties(address, rent_cents, status), " +
        "organizations(name, brand_color, logo_url, reply_to_email, nurture_enabled)",
    )
    .in("status", NURTURABLE_STATUSES as unknown as string[])
    .lt("nurture_step_sent", NURTURE_STEPS)
    .gt("created_at", oldestIso);

  if (error) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${error.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const rows = data ?? [];
  const summary: Summary = { ok: true, scanned: rows.length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const row of rows as any[]) {
   // Per-row isolation (audit C2): one row's thrown error must not abort the
   // rest of the sweep.
   try {
    // Supabase returns to-one relations as an object (or array on some shapes).
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

    const step = nurtureStepDue({
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : null,
      nowMs,
      status: row.status ?? "",
      stepsSent: row.nurture_step_sent ?? 0,
      lastSentAtMs: row.nurture_last_sent_at ? new Date(row.nurture_last_sent_at).getTime() : null,
      propertyStatus: property?.status ?? null,
      enabled: org?.nurture_enabled ?? true,
    });

    if (step === 0) {
      summary.skipped++;
      continue;
    }

    const renterEmail: string | null = row.email ?? null;
    if (!renterEmail) {
      summary.skipped++;
      summary.details.push({ lead: row.id, skipped: "no_email" });
      continue;
    }

    const result = await sendNurtureEmail({
      lead_id: row.id,
      property_id: row.property_id ?? null,
      step,
      renter_name: row.name ?? null,
      renter_email: renterEmail,
      org_name: org?.name ?? null,
      brand_color: org?.brand_color ?? null,
      logo_url: org?.logo_url ?? null,
      reply_to_email: org?.reply_to_email ?? null,
      property_address: property?.address ?? null,
      rent_cents: property?.rent_cents ?? null,
      no_suitable_time: row.no_suitable_time === true,
    });

    if (!result.sent) {
      summary.errors++;
      summary.details.push({ lead: row.id, error: result.reason });
      continue;
    }

    // Bump the watermark + pacing stamp so this lead advances exactly one step
    // and re-runs never double-send.
    const { error: stampErr } = await admin
      .from("leads")
      .update({ nurture_step_sent: step, nurture_last_sent_at: new Date().toISOString() })
      .eq("id", row.id);

    if (stampErr) {
      // The email went out but we couldn't stamp — surface it; a later run may
      // re-send the same step. Rare; logged so it's visible.
      summary.errors++;
      summary.details.push({ lead: row.id, error: `stamp_failed:${stampErr.message}` });
      continue;
    }

    await admin.from("messages").insert({
      organization_id: row.organization_id,
      lead_id: row.id,
      channel: "email",
      direction: "outbound",
      body: `Nurture email (step ${step}/${NURTURE_STEPS}) sent to ${renterEmail}` +
        (result.subject ? ` — "${result.subject}"` : ""),
    });

    summary.sent++;
    summary.details.push({
      lead: row.id,
      step,
      to: renterEmail,
      no_suitable_time: row.no_suitable_time === true,
    });
   } catch (err) {
     summary.errors++;
     summary.details.push({
       lead: (row as any)?.id,
       error: `row_threw:${err instanceof Error ? err.message : "unknown"}`,
     });
   }
  }

  return NextResponse.json(summary, { status: 200 });
}
