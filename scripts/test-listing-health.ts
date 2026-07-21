// Unit tests for the S548 listing-health alert selector.
// Run: npx tsx scripts/test-listing-health.ts
import { readFileSync } from "node:fs";
import { DEFAULT_REFRESH_DAYS } from "../lib/distribution-channels";
import { getNotificationEvent } from "../lib/notifications";
import {
  LISTING_HEALTH_COOLDOWN_DAYS,
  LISTING_HEALTH_EVENT_KEY,
  alertableListingHealthChannels,
  buildListingHealthDigest,
  buildListingHealthSnapshotLine,
  listingHealthChannels,
  listingHealthSnapshotSummary,
  type ListingHealthPost,
} from "../lib/listing-health";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const NOW = "2026-07-21T12:00:00.000Z";
const TODAY = "2026-07-21";
const APP_URL = "https://app.vacantless.com";

function post(over: Partial<ListingHealthPost> = {}): ListingHealthPost {
  return {
    id: over.id ?? "post-1",
    propertyId: over.propertyId ?? "property-1",
    address: over.address ?? "50 Glenrose Ave Unit 4",
    portal: over.portal ?? "kijiji",
    label: over.label ?? null,
    status: over.status ?? "live",
    url: over.url ?? "https://kijiji.ca/ad",
    postedOn: over.postedOn ?? "2026-07-01",
    lastHealthAlertedAt: over.lastHealthAlertedAt ?? null,
  };
}

// Stale live posts reuse the canonical distribution-channels threshold.
{
  const channels = listingHealthChannels({
    posts: [post({ postedOn: "2026-07-01" })],
    today: TODAY,
    nowISO: NOW,
  });
  ok("stale live post is selected", channels.length === 1);
  ok("stale reason", channels[0]?.reason === "stale");
  ok("stale uses default refresh days", DEFAULT_REFRESH_DAYS === 14);
  ok("stale live post is alertable when never stamped", channels[0]?.alertablePostIds.includes("post-1") === true);
}

// Fresh live posts are not noisy.
{
  const channels = listingHealthChannels({
    posts: [post({ postedOn: "2026-07-15" })],
    today: TODAY,
    nowISO: NOW,
  });
  ok("fresh live post is quiet", channels.length === 0);
}

// Expired/removed posts with no live replacement are actionable.
{
  const channels = listingHealthChannels({
    posts: [
      post({
        id: "expired-1",
        status: "expired",
        url: "https://rentfaster.ca/ad",
        portal: "rentfaster",
      }),
    ],
    today: TODAY,
    nowISO: NOW,
  });
  ok("expired post selected", channels.length === 1);
  ok("expired reason", channels[0]?.reason === "expired_or_removed");
  ok("RentFaster label used", channels[0]?.channelLabel === "RentFaster.ca");
}

// Cooldown prevents daily re-alerting, while the all-channel status remains visible.
{
  const channels = listingHealthChannels({
    posts: [post({ lastHealthAlertedAt: "2026-07-19T12:00:00.000Z" })],
    today: TODAY,
    nowISO: NOW,
  });
  ok("cooling channel still counted as unhealthy", channels.length === 1);
  ok("cooling channel has no alertable post ids", channels[0]?.alertablePostIds.length === 0);
  ok("cooling channel filtered out for proactive email", alertableListingHealthChannels(channels).length === 0);
}

// Seven-day cooldown boundary re-alerts.
{
  const channels = listingHealthChannels({
    posts: [post({ lastHealthAlertedAt: "2026-07-14T12:00:00.000Z" })],
    today: TODAY,
    nowISO: NOW,
  });
  ok("cooldown constant is seven days", LISTING_HEALTH_COOLDOWN_DAYS === 7);
  ok("seven-day-old alert can be sent again", alertableListingHealthChannels(channels).length === 1);
}

// A new channel crossing stale alerts even when another channel is cooling down.
{
  const channels = listingHealthChannels({
    posts: [
      post({ id: "kijiji-old", portal: "kijiji", lastHealthAlertedAt: "2026-07-19T12:00:00.000Z" }),
      post({
        id: "facebook-new",
        portal: "facebook",
        status: "removed",
        url: "https://facebook.com/marketplace/item/x",
      }),
    ],
    today: TODAY,
    nowISO: NOW,
  });
  const alertable = alertableListingHealthChannels(channels);
  ok("two unhealthy channels counted", channels.length === 2);
  ok("only new channel alerts", alertable.length === 1 && alertable[0].channel === "facebook");
}

// Digest is one org-level summary, not one email per channel.
{
  const channels = listingHealthChannels({
    posts: [
      post({ id: "a", propertyId: "property-1", portal: "kijiji" }),
      post({
        id: "b",
        propertyId: "property-2",
        address: "12 Donwoods Dr",
        portal: "rentfaster",
        status: "expired",
      }),
    ],
    today: TODAY,
    nowISO: NOW,
  });
  const digest = buildListingHealthDigest(channels, APP_URL);
  ok("digest counts ads/channels", digest.adCount === 2);
  ok("digest counts units", digest.unitCount === 2);
  ok("digest has first Distribute URL", digest.firstDistributeUrl?.includes("/dashboard/properties/property-2?tab=distribute") === true);
  ok("digest details include unit and channel", digest.detailsText.includes("12 Donwoods Dr: RentFaster.ca"));
}

// Snapshot line is honest-zero and links to Distribute only when there is work.
{
  ok("snapshot zero prints nothing", buildListingHealthSnapshotLine(null) === null);
  const channels = listingHealthChannels({
    posts: [post()],
    today: TODAY,
    nowISO: NOW,
  });
  const summary = listingHealthSnapshotSummary(channels, APP_URL);
  const line = buildListingHealthSnapshotLine(summary);
  ok("snapshot line counts ads", line?.includes("1 ad needs a refresh across 1 unit") === true);
  ok("snapshot line links Distribute", line?.includes("?tab=distribute") === true);
}

// Event registration: editable operator template, opt-in controlled by cron.
{
  const event = getNotificationEvent(LISTING_HEALTH_EVENT_KEY);
  ok("listing-health event registered", event?.key === "leasing.listing_health");
  ok("listing-health audience operator", event?.audience === "operator");
  ok("listing-health template has digest details token", event?.tokens.includes("listing_health_details") === true);
}

// Source guardrails.
const routeSource = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
ok("route uses event key", routeSource.includes("LISTING_HEALTH_EVENT_KEY"));
ok("route gates sends with isDripEnqueueEnabled", routeSource.includes("isDripEnqueueEnabled(setting)"));
ok("route sends through notification substrate", routeSource.includes("sendOrgNotification"));
ok("route stamps last_health_alerted_at", routeSource.includes("last_health_alerted_at"));
ok("route never fetches external portals", !routeSource.includes("fetch("));

const migration = readFileSync("supabase/migrations/0175_listing_health_alerts.sql", "utf8");
ok("migration adds idempotency column", migration.includes("last_health_alerted_at"));
ok("migration is additive", migration.includes("add column if not exists"));

console.log(`listing-health: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
