import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { siteCheckoutUrl } from "@/lib/distribution-publish";
import { CHANNEL_COST_CENTS } from "@/lib/distribution-channels";
import { siteName } from "@/lib/ads-still-up";
import { shortAddress } from "@/lib/posting-coverage";
import { checkoutReadyAction, checkoutReadyEmail } from "@/lib/checkout-ready";
import { claimNull } from "@/lib/claim-stamp";

// S829c: email the landlord when the robot leaves a paid ad waiting at a
// site's checkout, and remind once 4 hours later if it is still unpaid
// (lib/checkout-ready). Runs in the 15-minute sweep. ?dry=1 reports.

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";
// Agile's ads are posted by us for Noam; its operators do not need this email
// (same rule as posted-results-email).
const SKIP_ORG_IDS = new Set(["921f7c08-98af-428f-a238-36f4a781b0de"]);

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type ItemRow = {
  id: string;
  organization_id: string;
  channel: string;
  publish_status: string | null;
  operator_action_url: string | null;
  listing_post_id: string | null;
  checkout_notified_at: string | null;
  checkout_reminded_at: string | null;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" }, { status: 500 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = Date.now();

  const { data: rows, error } = await admin
    .from("distribution_run_items")
    .select("id, organization_id, channel, publish_status, operator_action_url, listing_post_id, checkout_notified_at, checkout_reminded_at")
    .or("publish_status.eq.needs_payment,checkout_notified_at.not.is.null,checkout_reminded_at.not.is.null")
    .limit(200);
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  let sent = 0;
  const report: { item: string; action: string }[] = [];
  for (const r of (rows ?? []) as ItemRow[]) {
    const checkoutUrl = siteCheckoutUrl(r.publish_status, r.operator_action_url);
    const action = checkoutReadyAction(
      { checkoutUrl, notifiedAt: r.checkout_notified_at, remindedAt: r.checkout_reminded_at },
      now,
    );
    if (action === "none") continue;
    if (action !== "clear" && SKIP_ORG_IDS.has(r.organization_id)) continue;
    report.push({ item: r.id, action });
    if (dry) continue;
    if (action === "clear") {
      await admin
        .from("distribution_run_items")
        .update({ checkout_notified_at: null, checkout_reminded_at: null })
        .eq("id", r.id);
      continue;
    }

    const { data: org } = await admin
      .from("organizations")
      .select("name, closed_at, brand_color, logo_url")
      .eq("id", r.organization_id)
      .maybeSingle();
    const o = org as { name: string | null; closed_at: string | null; brand_color: string | null; logo_url: string | null } | null;
    if (!o || o.closed_at) continue;

    let propertyId: string | null = null;
    let address: string | null = null;
    if (r.listing_post_id) {
      const { data: lp } = await admin.from("listing_posts").select("property_id").eq("id", r.listing_post_id).maybeSingle();
      propertyId = (lp as { property_id: string | null } | null)?.property_id ?? null;
      if (propertyId) {
        const { data: prop } = await admin.from("properties").select("address").eq("id", propertyId).maybeSingle();
        address = (prop as { address: string | null } | null)?.address ?? null;
      }
    }

    const stamp = action === "notify" ? "checkout_notified_at" : "checkout_reminded_at";
    const claim = await claimNull(admin, "distribution_run_items", { id: r.id }, stamp);
    if (claim.outcome !== "claimed") {
      report.push({ item: r.id, action: claim.outcome === "taken" ? "already_claimed" : `claim_failed:${claim.error}` });
      continue;
    }

    const mail = checkoutReadyEmail({
      siteLabel: siteName(r.channel),
      where: address ? shortAddress(address) : "your rental",
      priceCents: (CHANNEL_COST_CENTS as Record<string, number | undefined>)[r.channel] || null,
      reminder: action === "remind",
    });
    const url = propertyId
      ? `${APP_URL}/dashboard/properties/${propertyId}?tab=distribute`
      : `${APP_URL}/dashboard/sites`;
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", r.organization_id)
      .eq("role", "owner_admin");
    const recipients: string[] = [];
    for (const m of (members ?? []) as { user_id: string }[]) {
      const { data } = await getUserByIdCached(admin, m.user_id);
      const e = data.user?.email?.trim().toLowerCase();
      if (e && !recipients.includes(e)) recipients.push(e);
    }
    for (const to of recipients) {
      const res = await sendNotificationEmail({
        to_email: to,
        subject: mail.subject,
        body: mail.body,
        action_label: mail.actionLabel,
        action_url: url,
        org_name: o.name ?? "Vacantless",
        brand_color: o.brand_color ?? null,
        logo_url: o.logo_url ?? null,
        reply_to_email: null,
      }).catch(() => ({ sent: false }));
      if (res.sent) sent++;
    }
  }
  return NextResponse.json({ ok: true, sent, dry, report });
}
