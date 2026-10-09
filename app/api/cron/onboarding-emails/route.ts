import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { isQuietNotificationOrg } from "@/lib/quiet-orgs";
import { daysSince, stageOf, type AccountCounts } from "@/lib/new-account-watch";
import { decideOnboardingEmail } from "@/lib/onboarding-emails";

// S702j: the welcome email and the next-day nudge for new accounts. Runs every
// 30 minutes from .github/workflows/onboarding-emails.yml. Accounts made
// before ONBOARDING_EMAILS_START never get these emails. ?dry=1 lists what
// would be sent without sending.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";
/** Only accounts created after this ship time get the emails. */
const ONBOARDING_EMAILS_START = "2026-10-09T21:00:00Z";

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
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = new Date();
  const since = new Date(Math.max(Date.parse(ONBOARDING_EMAILS_START), now.getTime() - 14 * 86_400_000)).toISOString();

  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, created_at, plan, subscription_status, closed_at, onboarding_email_step")
    .gte("created_at", since)
    .is("closed_at", null)
    .lt("onboarding_email_step", 2);
  if (error) return NextResponse.json({ ok: false, reason: `orgs:${error.message}` });

  const count = async (table: string, orgId: string, notDraft = false) => {
    let q = admin.from(table).select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    if (notDraft) q = q.neq("status", "draft");
    const { count: c } = await q;
    return c ?? 0;
  };
  const replyTo = adminEmails()[0] ?? null;

  let sent = 0;
  const details: Record<string, unknown>[] = [];
  for (const o of orgs ?? []) {
    if (isQuietNotificationOrg(o.id)) continue;
    const [rentals, liveRentals, rules, overrides, enquiries, bookings] = await Promise.all([
      count("properties", o.id),
      count("properties", o.id, true),
      count("availability_rules", o.id),
      count("availability_overrides", o.id),
      count("leads", o.id),
      count("showings", o.id),
    ]);
    const counts: AccountCounts = {
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
    };
    const email = decideOnboardingEmail({
      stage: stageOf(counts),
      daysSinceSignup: daysSince(o.created_at, now),
      stepSent: o.onboarding_email_step ?? 0,
    });
    if (!email) continue;

    // The account owner's login email.
    const { data: owner } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", o.id)
      .eq("role", "owner_admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    let to: string | null = null;
    if (owner?.user_id) {
      const { data: u } = await admin.auth.admin.getUserById(owner.user_id as string);
      to = u?.user?.email ?? null;
    }
    if (!to) {
      details.push({ org: o.id, skipped: "no_owner_email" });
      continue;
    }
    if (dry) {
      details.push({ org: o.id, to, step: email.step, subject: email.subject });
      continue;
    }
    const r = await sendNotificationEmail({
      to_email: to,
      subject: email.subject,
      body: email.body,
      action_label: email.actionLabel,
      action_url: `${APP_URL.replace(/\/+$/, "")}${email.actionPath}`,
      org_name: "Vacantless",
      brand_color: null,
      logo_url: null,
      reply_to_email: replyTo,
    });
    if (!r.sent) {
      details.push({ org: o.id, step: email.step, error: r.reason });
      continue;
    }
    await admin
      .from("organizations")
      .update({ onboarding_email_step: email.step, onboarding_email_last_at: now.toISOString() })
      .eq("id", o.id);
    sent++;
    details.push({ org: o.id, step: email.step, sent: true });
  }
  return NextResponse.json({ ok: true, dry, sent, details });
}
