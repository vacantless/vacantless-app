// S737: the Renew box on the rentals list, and where the refresh email lands.
// Run: npx tsx scripts/test-renew-list.ts
import { readFileSync } from "node:fs";
import { buildListingHealthDigest, listingHealthChannels, renewListItems, type ListingHealthPost } from "../lib/listing-health";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const nowISO = "2026-10-26T00:00:00Z";
const post = (id: string, prop: string, portal: string, postedOn: string, status = "live"): ListingHealthPost => ({
  id,
  propertyId: prop,
  address: `Addr ${prop}`,
  portal,
  label: null,
  status,
  url: `https://www.facebook.com/marketplace/item/${id}/`,
  postedOn,
  createdAt: null,
  lastHealthAlertedAt: null,
});
const channels = listingHealthChannels({
  posts: [post("a", "p3", "facebook", "2026-10-15"), post("b", "p33", "facebook", "2026-10-15"), post("c", "p36", "facebook", "2026-10-25")],
  today: "2026-10-25",
  nowISO,
});
const items = renewListItems(channels, nowISO);
ok("two old Facebook ads listed", items.length === 2);
ok("fresh ad not listed", !items.some((i) => i.propertyId === "p36"));
ok("row has address, site and age", items[0].address === "Addr p3" && items[0].portal === "facebook" && items[0].days === 11);

const d = buildListingHealthDigest(channels, "https://app.vacantless.com", nowISO);
ok("several units: button opens the Renew box on the list", d.actionUrl === "https://app.vacantless.com/dashboard/properties#renew-ads");
ok("several units: button label", d.actionLabel === "See your old ads");

// S772: the old ads are marked on each rental's row (one row per rental);
// the box above the list became one slim line. The anchor stays for the email.
const page = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok("list page marks old ads on the row", page.includes("renewLine(item)"));
ok("box anchor", page.includes('id="renew-ads"'));
ok("renew opens the ad", page.includes('name="then" value="open"'));
ok("already renewed stays on the list", page.includes('name="back" value="list"'));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("renew all action exists", actions.includes("export async function markAllAdsRenewed"));
ok("renew all button", page.includes("I renewed them all"));
ok("all Marketplace ads in one page", page.includes("facebook.com/marketplace/you/selling"));
ok("action returns to the list", actions.includes('formData.get("back") === "list"'));

const cron = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
ok("refresh email uses the account's own date", cron.includes("today: localDateString(Date.parse(nowISO), org.booking_timezone"));

console.log(`\nrenew-list: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
