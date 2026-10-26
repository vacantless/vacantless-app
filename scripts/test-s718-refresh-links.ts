// Run with: npx tsx scripts/test-s718-refresh-links.ts
// S718: the "ads need a refresh" email lost one unit's link (2026-10-15) because
// that line repeated the button link, leaving a bare link for the other unit.
import { readFileSync } from "node:fs";
import { stripActionUrlLines } from "../lib/email";
import { getNotificationEvent, renderNotification } from "../lib/notifications";
import { buildListingHealthDigest } from "../lib/listing-health";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}
const APP = "https://app.vacantless.com";
const ch = (propertyId: string, address: string) => ({
  propertyId, address, channel: "facebook", channelLabel: "Facebook Marketplace", reason: "stale" as const,
  postIds: ["x"], alertablePostIds: ["x"], liveUrl: "https://fb", lastPostedOn: "2026-10-01",
});
const lh = getNotificationEvent("leasing.listing_health")!;
function finalBody(d: ReturnType<typeof buildListingHealthDigest>) {
  const out = renderNotification(lh, null, {
    affected_ads_count: String(d.adCount),
    listing_health_summary: d.summaryText,
    listing_health_details: d.detailsText,
    dashboard_url: d.actionUrl ?? "",
  });
  return stripActionUrlLines(out.body, d.actionUrl);
}

// Two units: every unit keeps its own link; the button opens the rentals list.
const two = buildListingHealthDigest([ch("p3", "833 Pillette Rd, Unit 3"), ch("p33", "833 Pillette Rd, Unit 33")], APP, "2026-10-15T12:00:00Z");
const twoBody = finalBody(two);
ok("two units: button opens the Renew box on the rentals list", two.actionUrl === `${APP}/dashboard/properties#renew-ads`, two.actionUrl);
ok("two units: button label", two.actionLabel === "Renew your ads");
ok("two units: Unit 3 link kept", twoBody.includes("/dashboard/properties/p3?tab=distribute#renew-ads"), twoBody);
ok("two units: Unit 33 link kept", twoBody.includes("/dashboard/properties/p33?tab=distribute#renew-ads"), twoBody);
ok("two units: each link sits under its ad", /Unit 3: Facebook Marketplace, posted 14 days ago\n\s+\S+p3\?/.test(twoBody), twoBody);

// One unit (even with two ads): no per-ad links, the button opens that rental.
const one = buildListingHealthDigest([ch("p9", "1551 Assumption St, Unit 9"), { ...ch("p9", "1551 Assumption St, Unit 9"), channelLabel: "Zumper" }], APP, "2026-10-15T12:00:00Z");
const oneBody = finalBody(one);
ok("one unit: button opens the rental", one.actionUrl === `${APP}/dashboard/properties/p9?tab=distribute#renew-ads`, one.actionUrl);
ok("one unit: button label", one.actionLabel === "Open the rental");
ok("one unit: no bare links in the body", !/https?:\/\//.test(oneBody), oneBody);
ok("one unit: both ads listed", oneBody.includes("Facebook Marketplace") && oneBody.includes("Zumper"));

// The cron uses the digest's button.
const route = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
ok("cron passes the digest button", route.includes("label: digest.actionLabel") && route.includes("url: digest.actionUrl ??"));

console.log(`\ns718-refresh-links: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
