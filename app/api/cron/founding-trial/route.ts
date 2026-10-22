import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendNotificationEmail } from "@/lib/email";
import {
  FOUNDING20_OFFER,
  foundingReminderDue,
  foundingReminderEmail,
  foundingTrialEmail,
  foundingTrialEnd,
} from "@/lib/founding-offer";

// S731: the Founding 20 free period. Checkout starts every founding
// subscription with 90 days free; this job ends the free period 30 days after
// the account's first viewing booked on or after the checkout, never later
// than the 90 days, and never lengthens it. Runs from the reminders workflow
// (every 15 minutes, cheap: only trialing accounts). ?dry=1 changes nothing.

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
  const stripe = getStripe();
  if (!admin || !stripe) {
    return NextResponse.json({ ok: true, scanned: 0, changed: 0, reason: "not_configured" });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const nowSec = Math.floor(Date.now() / 1000);

  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, stripe_subscription_id")
    .eq("subscription_status", "trialing")
    .not("stripe_subscription_id", "is", null);
  if (error) {
    return NextResponse.json({ ok: false, reason: `orgs:${error.message}` });
  }

  const details: Record<string, unknown>[] = [];
  let changed = 0;
  let errors = 0;
  for (const o of orgs ?? []) {
    try {
      const sub = await stripe.subscriptions.retrieve(o.stripe_subscription_id as string);
      if (sub.metadata?.founding_offer !== FOUNDING20_OFFER) continue;
      if (sub.status !== "trialing") continue;
      const { data: first } = await admin
        .from("showings")
        .select("created_at")
        .eq("organization_id", o.id)
        .gte("created_at", new Date(sub.created * 1000).toISOString())
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const firstBookingSec = first?.created_at ? Math.floor(Date.parse(first.created_at) / 1000) : null;
      // S731e: email the landlord at the address on the Stripe customer.
      const emailCustomer = async (msg: { subject: string; body: string }) => {
        const cust = await stripe.customers.retrieve(sub.customer as string);
        const to = !("deleted" in cust && cust.deleted) ? (cust as { email?: string | null }).email ?? null : null;
        if (!to) return "no_email";
        const r = await sendNotificationEmail({
          to_email: to,
          subject: msg.subject,
          body: msg.body,
          org_name: "Vacantless",
          brand_color: null,
          logo_url: null,
          reply_to_email: null,
        });
        return r.sent ? "sent" : `failed:${r.reason}`;
      };

      // S732: the price in the emails follows the checkout (with Posting = $98).
      const withPosting = sub.metadata?.founding_with_posting === "1";

      // The 7-day reminder before any founding free time ends (booking or not).
      if (
        foundingReminderDue({
          trialEndSec: sub.trial_end ?? null,
          nowSec,
          alreadySent: Boolean(sub.metadata?.founding_reminder_sent),
        })
      ) {
        details.push({ org: o.id, sub: sub.id, reminder: sub.trial_end, dry });
        if (!dry) {
          const sent = await emailCustomer(
            foundingReminderEmail({ trialEndSec: sub.trial_end as number, withPosting }),
          );
          await stripe.subscriptions.update(sub.id, {
            metadata: { ...(sub.metadata ?? {}), founding_reminder_sent: `${new Date().toISOString()} ${sent}` },
          });
          changed++;
        }
        continue;
      }

      const end = foundingTrialEnd({
        createdSec: sub.created,
        trialEndSec: sub.trial_end ?? null,
        firstBookingSec,
        nowSec,
      });
      if (end == null) continue;
      details.push({ org: o.id, sub: sub.id, from: sub.trial_end, to: end, dry });
      if (dry) continue;
      await stripe.subscriptions.update(sub.id, {
        trial_end: end,
        proration_behavior: "none",
        metadata: {
          ...(sub.metadata ?? {}),
          founding_trial_set: new Date().toISOString(),
          founding_first_booking: first?.created_at ?? "",
        },
      });
      changed++;
      const mailed = await emailCustomer(foundingTrialEmail({ endSec: end, nowSec, withPosting }));
      details.push({ org: o.id, emailed: mailed });
    } catch (err) {
      errors++;
      details.push({ org: o.id, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  if (changed > 0 || errors > 0) {
    console.log(`[founding-trial] scanned=${(orgs ?? []).length} changed=${changed} errors=${errors}`);
  }
  return NextResponse.json({ ok: errors === 0, scanned: (orgs ?? []).length, changed, errors, details });
}
