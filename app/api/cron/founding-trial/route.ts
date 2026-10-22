import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { FOUNDING20_OFFER, foundingTrialEnd } from "@/lib/founding-offer";

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
