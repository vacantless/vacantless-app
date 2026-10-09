// Run with: npx tsx scripts/test-posting-advice.ts
// S702: where-to-post advice from the landlord's own numbers.
import { readFileSync } from "node:fs";
import { buildPostingAdvice, groupBySite, siteOf } from "../lib/posting-advice";
import type { ChannelRow } from "../lib/reports";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const row = (source: string, leads: number, booked: number): ChannelRow => ({
  source, leads, booked, showed: 0, leased: 0, leaseRate: 0,
});

ok("email suffix grouped", siteOf("Kijiji (email)") === "Kijiji");
ok("screenshot suffix grouped", siteOf("Facebook Marketplace (screenshot)") === "Facebook Marketplace");
const g = groupBySite([row("Kijiji", 3, 1), row("Kijiji (email)", 2, 1)]);
ok("groups add up", g.length === 1 && g[0].enquiries === 5 && g[0].booked === 2);

ok("too little data, no advice", buildPostingAdvice([row("Kijiji", 4, 2)]).length === 0);

// Agile-like: mostly untracked, Facebook strong-ish, Rentals.ca 5 with 0.
const agile = buildPostingAdvice([
  row("website", 138, 35),
  row("Facebook Marketplace", 51, 4),
  row("Rentals.ca", 5, 0),
  row("Kijiji", 1, 0),
]);
ok("best named site", agile[0]?.tone === "good" && agile[0].text.startsWith("Facebook Marketplace brings"));
ok("website never praised", !agile.some((a) => a.text.startsWith("website")));
ok("dud flagged", agile.some((a) => a.tone === "fix" && a.text.startsWith("Rentals.ca sent 5 enquiries")));
ok("untracked share flagged", agile.some((a) => a.text.includes("% of your renters")));
ok("Kijiji present so not suggested", !agile.some((a) => a.tone === "try"));
ok("at most 3", agile.length <= 3);

const fresh = buildPostingAdvice([row("Zumper + PadMapper", 6, 2)]);
ok("suggests both free sites", fresh.some((a) => a.tone === "try" && a.text.includes("Kijiji or Facebook Marketplace")));
ok("no em dash", ![...agile, ...fresh].some((a) => /[—–]/.test(a.text)));
ok("singular enquiry", buildPostingAdvice([row("Kijiji", 1, 0), row("Facebook Marketplace", 5, 0)]).some((a) => a.text.includes("5 enquiries")));

const page = readFileSync("app/dashboard/reports/page.tsx", "utf8");
ok("reports page shows advice", page.includes("buildPostingAdvice(channels)") && page.includes("Where to post next"));

console.log(`\nposting-advice: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
