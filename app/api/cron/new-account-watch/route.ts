import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { loadOutsideAccounts } from "@/lib/account-counts-server";
import {
  FIRST_LIVE_MEDIAN_DAYS,
  buildWatchEmail,
  firstLiveFooter,
  buildWatchRows,
} from "@/lib/new-account-watch";

// S702: the daily new-account email to Noam. Run once a day from
// .github/workflows/new-account-watch.yml. Lists every account that signed up
// in the last 14 days and how far it got, so a stalled landlord gets a personal
// email the same day. Sends nothing on a day with no new accounts.
// ?dry=1 returns the email without sending it.

// S748: every sweep gets the full 60 s; sweep-all waits up to 50 s for each.
export const maxDuration = 60;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return false; // S751: header only (a secret in the URL lands in request logs)
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
  // S767: 30 days back for the time-to-first-live median; the list itself
  // still shows the last 14 (buildWatchRows).
  const since = new Date(now.getTime() - (FIRST_LIVE_MEDIAN_DAYS + 1) * 86_400_000).toISOString();

  // S800: the loader is shared with the admin funnel (lib/account-counts-server).
  const { accounts, excluded: exclude, error } = await loadOutsideAccounts(admin, since);
  if (error) {
    return NextResponse.json({ ok: false, reason: error });
  }

  const rows = buildWatchRows(accounts, now, exclude);
  const email = buildWatchEmail(rows, firstLiveFooter(accounts, now));
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
