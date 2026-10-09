import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readChannelSession } from "@/lib/distribution-session-crypto";
import {
  buildPageFeedMessage,
  postToFacebookPageFeed,
} from "@/lib/facebook-page-graph";
import { fbPageChannelEnabled } from "@/lib/facebook-page-oauth";
import { buildTrackedLink } from "@/lib/listing-distribution";
import { localDateString } from "@/lib/leasing-snapshot";
import { isQuietNotificationOrg } from "@/lib/quiet-orgs";
import { duePageReposts } from "@/lib/page-weekly-posts";

// S702i: weekly automatic posts to each opted-in landlord's Facebook Page.
// Run once a day from .github/workflows/page-weekly-posts.yml; each rental is
// posted at most once every 7 days (lib/page-weekly-posts). The post goes
// through the Page token the landlord stored when they connected their Page,
// with Facebook's own Page API. Nobody's Facebook login is used.
// ?dry=1 lists what would be posted without posting. ?org=<id> limits a run.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";
const CHANNEL = "facebook_feed";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

type Detail = Record<string, unknown>;

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  if (!fbPageChannelEnabled()) {
    return NextResponse.json({ ok: true, reason: "page_channel_off", posted: 0 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, reason: "service_role_not_configured" });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const onlyOrg = req.nextUrl.searchParams.get("org");

  let orgQuery = admin
    .from("organizations")
    .select("id, name, booking_timezone, closed_at")
    .eq("page_weekly_posts", true)
    .is("closed_at", null);
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error } = await orgQuery;
  if (error) return NextResponse.json({ ok: false, reason: `orgs:${error.message}` });

  let posted = 0;
  let errors = 0;
  const details: Detail[] = [];

  for (const org of orgs ?? []) {
    // Test orgs never post to a real Page from the schedule. A hand run with
    // ?org= still can, so a test Page can be checked on purpose.
    if (!onlyOrg && isQuietNotificationOrg(org.id)) {
      details.push({ org: org.id, skipped: "quiet_org" });
      continue;
    }
    const { data: account } = await admin
      .from("distribution_channel_accounts")
      .select("account_status")
      .eq("organization_id", org.id)
      .eq("channel", CHANNEL)
      .maybeSingle();
    if (!account || account.account_status !== "connected") {
      details.push({ org: org.id, skipped: "page_not_connected" });
      continue;
    }

    let session: { page_id?: unknown; page_access_token?: unknown } | null = null;
    try {
      session = await readChannelSession({ organizationId: org.id, channel: CHANNEL, admin });
    } catch {
      session = null;
    }
    const pageId = typeof session?.page_id === "string" ? session.page_id.trim() : "";
    const token =
      typeof session?.page_access_token === "string" ? session.page_access_token.trim() : "";
    if (!pageId || !token) {
      details.push({ org: org.id, skipped: "no_page_token" });
      continue;
    }

    const today = localDateString(Date.now(), org.booking_timezone || "America/Toronto");
    const [{ data: props }, { data: posts }] = await Promise.all([
      admin
        .from("properties")
        .select("id, status, archived_at, address, beds, baths, rent_cents")
        .eq("organization_id", org.id)
        .eq("status", "available")
        .is("archived_at", null),
      admin
        .from("listing_posts")
        .select("id, property_id, status, posted_on, created_at")
        .eq("organization_id", org.id)
        .eq("portal", CHANNEL),
    ]);
    const propRows = (props ?? []) as {
      id: string;
      status: string | null;
      archived_at: string | null;
      address: string | null;
      beds: number | null;
      baths: number | null;
      rent_cents: number | null;
    }[];
    const postRows = (posts ?? []) as {
      id: string;
      property_id: string;
      status: string | null;
      posted_on: string | null;
      created_at: string | null;
    }[];
    const due = duePageReposts({
      properties: propRows.map((p) => ({ id: p.id, status: p.status, archivedAt: p.archived_at })),
      posts: postRows.map((p) => ({
        propertyId: p.property_id,
        status: p.status,
        postedOn: p.posted_on,
        createdAt: p.created_at,
      })),
      today,
    });

    for (const propertyId of due) {
      const p = propRows.find((r) => r.id === propertyId);
      if (!p) continue;
      // Reuse the rental's Page post row so inquiries stay attributed to it.
      const existing = postRows
        .filter((r) => r.property_id === propertyId && r.status !== "removed")
        .sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1))[0];
      const publicUrl = `${APP_URL.replace(/\/+$/, "")}/r/${propertyId}`;
      const link = existing ? buildTrackedLink(publicUrl, existing.id) : publicUrl;
      const message = buildPageFeedMessage({
        address: p.address,
        beds: p.beds,
        baths: p.baths,
        rentCents: p.rent_cents,
        publicUrl: link,
      });
      if (dry) {
        details.push({ org: org.id, property: propertyId, would_post: true });
        continue;
      }

      const graph = await postToFacebookPageFeed({ pageId, pageAccessToken: token, message, link });
      if (!graph.ok) {
        errors++;
        details.push({ org: org.id, property: propertyId, error: graph.error });
        if (graph.isAuthError) {
          // The Page token stopped working (password change, removed access).
          // Stop for this org and show "reconnect" on the Get online tab.
          const nowISO = new Date().toISOString();
          await admin
            .from("distribution_channel_accounts")
            .update({
              account_status: "needs_login",
              automation_authorized: false,
              last_setup_checked_at: nowISO,
              updated_at: nowISO,
            })
            .eq("organization_id", org.id)
            .eq("channel", CHANNEL);
          break;
        }
        continue;
      }

      if (existing) {
        await admin
          .from("listing_posts")
          .update({ url: graph.permalink, status: "live", posted_on: today })
          .eq("id", existing.id);
      } else {
        await admin.from("listing_posts").insert({
          organization_id: org.id,
          property_id: propertyId,
          portal: CHANNEL,
          url: graph.permalink,
          status: "live",
          posted_on: today,
        });
      }
      await admin
        .from("distribution_channel_accounts")
        .update({ last_successful_publish_at: new Date().toISOString() })
        .eq("organization_id", org.id)
        .eq("channel", CHANNEL);
      posted++;
      details.push({ org: org.id, property: propertyId, posted: graph.permalink });
    }
  }

  return NextResponse.json({ ok: errors === 0, dry, posted, errors, details });
}
