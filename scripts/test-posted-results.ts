// S734: tests for lib/posted-results.ts. Run: npx tsx scripts/test-posted-results.ts
import { postedResultsHeadline, postedResultsNextSteps, postedResultsSites } from "../lib/posted-results";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => (c ? pass++ : (fail++, console.log("FAIL:", n, x ?? "")));

const posts = [
  { portal: "kijiji", status: "live", url: "https://www.kijiji.ca/v-apartments/1" },
  { portal: "facebook_feed", status: "live", url: "https://www.facebook.com/1_2" },
  { portal: "facebook", status: "removed", url: "https://www.facebook.com/marketplace/item/3" },
  { portal: "zumper", status: "live", url: " " },
  { portal: "kijiji", status: "live", url: "https://www.kijiji.ca/v-apartments/9" },
  { portal: "rentals_ca", status: "expired", url: "https://rentals.ca/x" },
];
const sites = postedResultsSites(posts);
ok("live sites with a link, one per site, Page first", sites.map((s) => s.key).join(",") === "facebook_feed,kijiji", sites);
ok("labels are site names", sites[0].label === "Facebook Page" && sites[1].label === "Kijiji");
ok("first link wins", sites[1].url.endsWith("/1"));
ok("empty", postedResultsSites([]).length === 0);

ok("headline counts the Vacantless page", postedResultsHeadline(2) === "Live on 3 sites");
ok("headline with nothing else live", postedResultsHeadline(0) === "Your rental page is live");

const steps = postedResultsNextSteps({
  propertyId: "p1",
  liveKeys: ["facebook_feed"],
  facebookPageConnected: true,
  robotPostingAllowed: false,
  marketplaceKitAvailable: true,
});
ok("marketplace first, then posting, no page step when connected", steps.map((s) => s.key).join(",") === "marketplace,posting", steps);
ok("marketplace step opens the kit row", steps[0].href === "/dashboard/properties/p1?tab=distribute#for-you-facebook");
ok("posting step goes to billing", steps[1].href === "/dashboard/billing#posting-addon");

const steps2 = postedResultsNextSteps({
  propertyId: "p1",
  liveKeys: ["facebook", "kijiji"],
  facebookPageConnected: false,
  robotPostingAllowed: true,
  marketplaceKitAvailable: true,
});
ok("only the page step when marketplace is live and posting is on", steps2.map((s) => s.key).join(",") === "facebook_page", steps2);

const steps3 = postedResultsNextSteps({
  propertyId: "p1",
  liveKeys: [],
  facebookPageConnected: false,
  robotPostingAllowed: false,
  marketplaceKitAvailable: false,
});
ok("no kit before the page is live: page and posting only", steps3.map((s) => s.key).join(",") === "facebook_page,posting", steps3);
ok("no em dashes", !steps.concat(steps2, steps3).some((s) => /[—–]/.test(s.title + s.body + s.action)));

console.log(`posted-results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
