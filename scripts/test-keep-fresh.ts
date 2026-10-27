// S739 "Keep it fresh" card (review item 10). Run: npx tsx scripts/test-keep-fresh.ts
import { readFileSync } from "node:fs";
import { keepFreshRows, shortDate } from "@/lib/keep-fresh";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

const today = "2026-10-27";
const card = (key: string, label: string, lastPostedOn: string | null, status = "posted", liveUrl: string | null = "https://x") => ({ key, label, status, lastPostedOn, liveUrl });
const row = (r: ReturnType<typeof keepFreshRows>, key: string) => r.find((x) => x.key === key);

ok("short date", shortDate("2026-11-12") === "Nov 12");

// Agile's Pillette 33 on 2026-10-27: Marketplace renewed Oct 19.
const r = keepFreshRows(
  [
    card("facebook", "Facebook Marketplace", "2026-10-19"),
    card("kijiji", "Kijiji", "2026-10-12"),
    card("rentals_ca", "Rentals.ca", "2026-10-11"),
    card("zumper", "Zumper", "2026-09-06"),
    card("facebook_feed", "Facebook Page", "2026-10-27"),
    card("instagram", "Instagram", "2026-10-20"),
  ],
  { today, rentalsRobotRenews: true },
);
ok("marketplace waits a day", row(r, "facebook")?.line === "Renew opens in 1 day." && !row(r, "facebook")?.renew, row(r, "facebook"));
ok("kijiji end date", row(r, "kijiji")?.line === "Ad ends Nov 12." && !row(r, "kijiji")?.renew, row(r, "kijiji"));
ok("rentals.ca renews itself", row(r, "rentals_ca")?.line.startsWith("We renew this free ad") === true && !row(r, "rentals_ca")?.renew);
ok("zumper stays up", row(r, "zumper")?.line === "Stays up while the rental is open." && !row(r, "zumper")?.renew);
ok("page posted today", row(r, "facebook_feed")?.line === "Posted on your Page today." && !row(r, "facebook_feed")?.renew);
ok("instagram age", row(r, "instagram")?.line === "Posted 7 days ago.");

// Day 9 on Marketplace: renew now.
const due = keepFreshRows([card("facebook", "Facebook Marketplace", "2026-10-18")], { today, rentalsRobotRenews: false });
ok("marketplace day 9 offers Renew", due[0].renew && due[0].line.startsWith("Facebook lets you renew it now"), due);
// Stale even if the date says otherwise.
ok("stale always offers Renew", keepFreshRows([card("facebook", "Facebook Marketplace", "2026-10-26", "needs_refresh")], { today, rentalsRobotRenews: false })[0].renew);
// Rentals.ca without the robot.
const rc = keepFreshRows([card("rentals_ca", "Rentals.ca", "2026-10-09")], { today, rentalsRobotRenews: false });
ok("rentals.ca by hand: end date and Renew at day 18", rc[0].line === "Free ad ends Oct 30." && rc[0].renew, rc);
ok("rentals.ca by hand before day 18: no button", !keepFreshRows([card("rentals_ca", "Rentals.ca", "2026-10-20")], { today, rentalsRobotRenews: false })[0].renew);
// Stale Kijiji says renew.
ok("stale kijiji", keepFreshRows([card("kijiji", "Kijiji", "2026-09-30", "needs_refresh")], { today, rentalsRobotRenews: false })[0].line === "Ad ends Oct 31. Renew it on Kijiji.");
// Not live: left out.
ok("no link, no row", keepFreshRows([card("kijiji", "Kijiji", "2026-10-12", "posted", null), card("zumper", "Zumper", null, "not_started")], { today, rentalsRobotRenews: false }).length === 0);

const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page renders the one card", page.includes("<KeepFreshCard") && !page.includes("<RenewAdsCard") && !page.includes("<PageWeeklyPostsCard"));
const cardSrc = readFileSync("app/dashboard/properties/[id]/keep-fresh-card.tsx", "utf8");
ok("emailed link anchor kept", cardSrc.includes('id="renew-ads"'));
ok("same actions as before", cardSrc.includes("markAdsRenewed") && cardSrc.includes("setPageWeeklyPosts") && cardSrc.includes('name="then" value="open"'));

console.log(`keep-fresh: ${p} passed, ${f} failed`);
if (f) process.exit(1);
