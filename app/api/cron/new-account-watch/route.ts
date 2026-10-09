import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { QUIET_NOTIFICATION_ORGANIZATION_IDS } from "@/lib/quiet-orgs";
import {
  WATCH_WINDOW_DAYS,
  buildWatchEmail,
  buildWatchRows,
  type AccountCounts,
} from "@/lib/new-account-watch";

// S702: the daily new-account email to Noam. Run once a day from
// .github/workflows/new-account-watch.yml. Lists every account that signed up
// in the last 14 days and how far it got, so a stalled landlord gets a personal
// email the same day. Sends nothing on a day with no new accounts.
// ?dry=1 returns the email without sending it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, reason: "service_role_not_configured" });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = new Date();
  const since = new Date(now.getTime() - (WATCH_WINDOW_DAYS + 1) * 86_400_000).toISOString();

  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, plan, subscription_status, created_at, closed_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ ok: false, reason: `orgs:${error.message}` });
  }

  const exclude = new Set(QUIET_NOTIFICATION_ORGANIZATION_IDS);
  const count = async (table: string, orgId: string, notDraft = false) => {
    let q = admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (notDraft) q = q.neq("status", "draft");
    const { count: c } = await q;
    return c ?? 0;
  };

  const accounts: AccountCounts[] = [];
  for (const o of orgs ?? []) {
    if (exclude.has(o.id)) continue;
    const [rentals, liveRentals, rules, overrides, enquiries, bookings] = await Promise.all([
      count("properties", o.id),
      count("properties", o.id, true),
      count("availability_rules", o.id),
      count("availability_overrides", o.id),
      count("leads", o.id),
      count("showings", o.id),
    ]);
    accounts.push({
      id: o.id,
      name: o.name,
      createdAt: o.created_at,
      plan: o.plan,
      subscriptionStatus: o.subscription_status,
      closedAt: o.closed_at,
      rentals,
      liveRentals,
      viewingTimes: rules + overrides,
      enquiries,
      bookings,
    });
  }

  const rows = buildWatchRows(accounts, now, exclude);
  const email = buildWatchEmail(rows);
  if (!email) {
    return NextResponse.json({ ok: true, sent: 0, accounts: 0, reason: "no_new_accounts" });
  }
  if (dry) {
    return NextResponse.json({ ok: true, dry: true, accounts: rows.length, ...email });
  }

  const recipients = adminEmails();
  const to = recipients.length > 0 ? recipients : ["hello@vacantless.com"];
  let sent = 0;
  const errors: string[] = [];
  for (const addr of to) {
    const r = await sendNotificationEmail({
      to_email: addr,
      subject: email.subject,
      body: email.body,
      org_name: "Vacantless",
      brand_color: null,
      logo_url: null,
      reply_to_email: null,
    });
    if (r.sent) sent++;
    else errors.push(`${addr}:${r.reason}`);
  }
  return NextResponse.json({
    ok: errors.length === 0,
    sent,
    accounts: rows.length,
    stalled: rows.filter((r) => r.stalled).length,
    errors,
  });
}
