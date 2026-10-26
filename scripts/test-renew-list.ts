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
  posts: [post("a", "p3", "facebook", "2026-10-18"), post("b", "p33", "facebook", "2026-10-18"), post("c", "p36", "facebook", "2026-10-25")],
  today: "2026-10-25",
  nowISO,
});
const items = renewListItems(channels, nowISO);
ok("two old Facebook ads listed", items.length === 2);
ok("fresh ad not listed", !items.some((i) => i.propertyId === "p36"));
ok("row has address, site and age", items[0].address === "Addr p3" && items[0].portal === "facebook" && items[0].days === 8);

const d = buildListingHealthDigest(channels, "https://app.vacantless.com", nowISO);
ok("several units: button opens the Renew box on the list", d.actionUrl === "https://app.vacantless.com/dashboard/properties#renew-ads");
ok("several units: button label", d.actionLabel === "Renew your ads");

const page = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok("list page renders the box", page.includes("<RenewListCard"));
const card = readFileSync("app/dashboard/properties/renew-list-card.tsx", "utf8");
ok("box anchor", card.includes('id="renew-ads"'));
ok("renew opens the ad", card.includes('name="then" value="open"'));
ok("already renewed stays on the list", card.includes('name="back" value="list"'));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("renew all action exists", actions.includes("export async function markAllAdsRenewed"));
ok("renew all button", card.includes("I renewed them all"));
ok("all Marketplace ads in one page", card.includes("facebook.com/marketplace/you/selling"));
ok("action returns to the list", actions.includes('formData.get("back") === "list"'));

const cron = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
ok("refresh email uses the account's own date", cron.includes("today: localDateString(Date.parse(nowISO), org.booking_timezone"));

console.log(`\nrenew-list: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
