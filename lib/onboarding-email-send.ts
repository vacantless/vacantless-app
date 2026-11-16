import { getUserByIdCached } from "@/lib/auth-email-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { isQuietNotificationOrg } from "@/lib/quiet-orgs";
import { daysSince, stageOf, type AccountCounts } from "@/lib/new-account-watch";
import { decideOnboardingEmail } from "@/lib/onboarding-emails";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { claimStep, releaseClaim } from "@/lib/claim-stamp";

// S702j: the welcome email and the next-day nudge for new accounts.
// S801: moved out of the cron route so sign-up can send the welcome at once
// (app/onboarding/actions.ts) instead of waiting for the next sweep. The cron
// stays as the safety net; claimStep makes sure an account gets each email once.

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";
/** Only accounts created after this ship time get the emails. */
export const ONBOARDING_EMAILS_START = "2026-10-09T21:00:00Z";
export const ONBOARDING_ORG_COLUMNS =
  "id, name, created_at, plan, subscription_status, closed_at, onboarding_email_step";

export type OnboardingOrgRow = {
  id: string;
  name: string;
  created_at: string;
  plan: string | null;
  subscription_status: string | null;
  closed_at: string | null;
  onboarding_email_step: number | null;
};

/** One account: decide, claim, send. detail is null when there was nothing to do. */
export async function processOnboardingOrg(
  admin: Admin,
  o: OnboardingOrgRow,
  opts: { now: Date; dry: boolean; replyTo: string | null },
): Promise<{ sent: boolean; detail: Record<string, unknown> | null }> {
  const { now, dry, replyTo } = opts;
  if (isQuietNotificationOrg(o.id)) return { sent: false, detail: null };

  const count = async (table: string, notDraft = false) => {
    let q = admin.from(table).select("id", { count: "exact", head: true }).eq("organization_id", o.id);
    if (notDraft) q = q.neq("status", "draft");
    const { count: c } = await q;
    return c ?? 0;
  };
  const [rentals, liveRentals, rules, overrides, enquiries, bookings] = await Promise.all([
    count("properties"),
    count("properties", true),
    count("availability_rules"),
    count("availability_overrides"),
    count("leads"),
    count("showings"),
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
    addPropertyV2Enabled: envFlagEnabled(process.env.ADD_PROPERTY_V2_ENABLED),
  });
  if (!email) return { sent: false, detail: null };

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
    const { data: u } = await getUserByIdCached(admin, owner.user_id as string);
    to = u?.user?.email ?? null;
  }
  if (!to) return { sent: false, detail: { org: o.id, skipped: "no_owner_email" } };
  if (dry) return { sent: false, detail: { org: o.id, to, step: email.step, subject: email.subject } };

  // S742c: claim the step before sending.
  const claim = await claimStep(admin, "organizations", { id: o.id }, "onboarding_email_step", email.step, {
    onboarding_email_last_at: now.toISOString(),
  });
  if (claim.outcome !== "claimed") {
    return {
      sent: false,
      detail: { org: o.id, step: email.step, skipped: claim.outcome === "taken" ? "already_claimed" : `claim_failed:${claim.error}` },
    };
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
    await releaseClaim(admin, "organizations", { id: o.id }, {
      onboarding_email_step: o.onboarding_email_step ?? 0,
    });
    return { sent: false, detail: { org: o.id, step: email.step, error: r.reason } };
  }
  return { sent: true, detail: { org: o.id, step: email.step, sent: true } };
}

/** Sign-up path: send the welcome for one brand-new account right now. Never throws. */
export async function sendWelcomeNow(orgId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    const { data: o } = await admin
      .from("organizations")
      .select(ONBOARDING_ORG_COLUMNS)
      .eq("id", orgId)
      .is("closed_at", null)
      .lt("onboarding_email_step", 1)
      .maybeSingle();
    if (!o || Date.parse((o as OnboardingOrgRow).created_at) < Date.parse(ONBOARDING_EMAILS_START)) return;
    await processOnboardingOrg(admin, o as OnboardingOrgRow, {
      now: new Date(),
      dry: false,
      replyTo: adminEmails()[0] ?? null,
    });
  } catch (e) {
    // The 30-minute sweep sends it if this fails.
    console.error("[onboarding-emails] welcome at sign-up failed", e instanceof Error ? e.message : e);
  }
}
