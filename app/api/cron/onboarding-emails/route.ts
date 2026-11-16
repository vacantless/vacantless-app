import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminEmails } from "@/lib/provisioning-server";
import {
  ONBOARDING_EMAILS_START,
  ONBOARDING_ORG_COLUMNS,
  processOnboardingOrg,
  type OnboardingOrgRow,
} from "@/lib/onboarding-email-send";

// S702j: the welcome email and the next-day nudge for new accounts. Runs every
// 30 minutes from .github/workflows/onboarding-emails.yml. Accounts made
// before ONBOARDING_EMAILS_START never get these emails. ?dry=1 lists what
// would be sent without sending.

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
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = new Date();
  const since = new Date(Math.max(Date.parse(ONBOARDING_EMAILS_START), now.getTime() - 14 * 86_400_000)).toISOString();

  const { data: orgs, error } = await admin
    .from("organizations")
    .select(ONBOARDING_ORG_COLUMNS)
    .gte("created_at", since)
    .is("closed_at", null)
    .lt("onboarding_email_step", 2);
  if (error) return NextResponse.json({ ok: false, reason: `orgs:${error.message}` });

  const replyTo = adminEmails()[0] ?? null;

  let sent = 0;
  const details: Record<string, unknown>[] = [];
  for (const o of (orgs ?? []) as OnboardingOrgRow[]) {
    const r = await processOnboardingOrg(admin, o, { now, dry, replyTo });
    if (r.sent) sent++;
    if (r.detail) details.push(r.detail);
  }
  return NextResponse.json({ ok: true, dry, sent, details });
}
