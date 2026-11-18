// S818c: what each rental site costs you (Reports).
// Run: npx tsx scripts/test-s818c-site-costs.ts
import { readFileSync } from "node:fs";
import { buildSiteCosts, buildCostAdvice, costSite, parseDollarsToCents, dollars, COST_SITE_OPTIONS } from "../lib/channel-costs";
import type { ChannelRow } from "../lib/reports";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const ch = (source: string, leads: number, booked: number, showed = 0, leased = 0): ChannelRow => ({ source, leads, booked, showed, leased, leaseRate: 0 });

// Agile's last 90 days, with the two paid Kijiji ads.
const channels = [
  ch("Facebook Marketplace", 79, 7, 3),
  ch("website", 60, 11, 5),
  ch("Rentals.ca", 10, 0),
  ch("Zumper + PadMapper", 7, 0),
  ch("Kijiji", 3, 0),
  ch("Kijiji (email)", 2, 0),
];
const costs = [
  { portal: "kijiji", amount_cents: 3384, spent_on: "2026-09-03" },
  { portal: "kijiji", amount_cents: 3384, spent_on: "2026-10-12" },
];
const rows = buildSiteCosts(channels, costs);
const kij = rows.find((r) => r.site === "Kijiji");
ok("kijiji folds email into one site", kij?.renters === 5);
ok("kijiji spent", kij?.spentCents === 6768);
ok("kijiji per renter", kij?.perRenterCents === 1354);
ok("kijiji no booked, no per-booked", kij?.perBookedCents === null);
ok("page link not a site", !rows.some((r) => r.site.toLowerCase() === "website"));
ok("marketplace first", rows[0]?.site === "Facebook Marketplace");
ok("free site no per-renter", rows[0]?.perRenterCents === null);

const advice = buildCostAdvice(rows);
ok("kijiji fix line", advice.some((a) => a.tone === "fix" && a.text.includes("$67.68 to Kijiji") && a.text.includes("5 renters")));
ok("free best line", advice.some((a) => a.tone === "good" && a.text.startsWith("Facebook Marketplace cost you nothing") && a.text.includes("7 booked")));
for (const a of advice) ok("no em dash", !a.text.includes("—"));

// A paid site that worked.
const r2 = buildSiteCosts([ch("Rentals.ca", 10, 2)], [{ portal: "rentals_ca", amount_cents: 5000, spent_on: "2026-11-01" }]);
ok("per booked", r2[0].perBookedCents === 2500);
ok("cheapest paid line", buildCostAdvice(r2).some((a) => a.text.includes("$25 per booked viewing")));

// A cost for a site with no renters still shows.
const r3 = buildSiteCosts([], [{ portal: "viewit", amount_cents: 4500, spent_on: "2026-11-01" }]);
ok("viewit row", r3[0]?.site === "Viewit.ca" && r3[0].renters === 0 && r3[0].perRenterCents === null);
ok("viewit advice", buildCostAdvice(r3).some((a) => a.text.includes("$45 to Viewit.ca") && a.text.includes("0 renters")));

ok("other label", costSite({ portal: "other", label: "Kijiji boost" }) === "Kijiji boost");
ok("other blank", costSite({ portal: "other", label: " " }) === "Other");
ok("unknown portal", costSite({ portal: "zzz" }) === "Other");
ok("facebook label", costSite({ portal: "facebook" }) === "Facebook Marketplace");

ok("parse $33.84", parseDollarsToCents("$33.84") === 3384);
ok("parse 1,200", parseDollarsToCents("1,200") === 120000);
ok("parse junk", parseDollarsToCents("abc") === null && parseDollarsToCents("0") === null && parseDollarsToCents("1.234") === null);
ok("dollars", dollars(3384) === "$33.84" && dollars(5000) === "$50");
ok("options include viewit and other", COST_SITE_OPTIONS.some((o) => o.key === "viewit") && COST_SITE_OPTIONS.some((o) => o.key === "other"));

// Wiring.
const mig = readFileSync("supabase/migrations/0310_marketing_costs.sql", "utf8");
ok("0310 rls", mig.includes("enable row level security") && mig.includes("marketing_costs_member_all"));
ok("0310 grants", mig.includes("to authenticated") && mig.includes("to service_role") && mig.includes("from anon"));
const page = readFileSync("app/dashboard/reports/page.tsx", "utf8");
ok("reports reads costs", page.includes('.from("marketing_costs")'));
ok("reports section", page.includes("What each site costs you") && page.includes("buildSiteCosts("));
ok("reports add form", page.includes("addMarketingCost") && page.includes("removeMarketingCost"));
const act = readFileSync("app/dashboard/reports/actions.ts", "utf8");
ok("action checks money", act.includes("parseDollarsToCents("));
ok("action scoped to org", act.includes("organization_id: org.id") && act.includes('.eq("organization_id", org.id)'));

console.log(`test-s818c-site-costs: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
