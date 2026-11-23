// S832: the "pays for itself" table and the grouped paid-plan list.
// Run: npx tsx scripts/test-s832-vendor-costs.ts
import { readFileSync } from "node:fs";
import { VENDOR_COSTS, VENDOR_COSTS_HEAD, formatCheckedOn } from "../lib/vendor-costs";
import { PAID_FEATURE_GROUPS, TIERS } from "../lib/billing";

let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// 1. Every vendor line has a job, a feature, a price with a named currency, a
// vendor, an https source and a real date (Noam's rule, 2026-11-22).
ok("seven vendor lines", VENDOR_COSTS.length === 7);
for (const v of VENDOR_COSTS) {
  ok(`${v.job}: has a Vacantless feature`, v.inVacantless.trim().length > 10);
  ok(`${v.job}: price names its currency`, /\b(US|CA)\$\d/.test(v.typicalPrice));
  ok(`${v.job}: https source`, /^https:\/\/[^\s]+$/.test(v.sourceUrl));
  ok(`${v.job}: vendor named`, v.vendor.trim().length > 3);
  ok(`${v.job}: checkedOn is a date`, /^\d{4}-\d{2}-\d{2}$/.test(v.checkedOn) && !Number.isNaN(Date.parse(v.checkedOn)));
  const ageDays = (Date.now() - Date.parse(v.checkedOn)) / 86_400_000;
  if (ageDays > 180) console.log(`WARN ${v.job}: price checked ${Math.round(ageDays)} days ago; re-check ${v.sourceUrl}`);
}
ok("both kinds present", VENDOR_COSTS.some((v) => v.kind === "monthly") && VENDOR_COSTS.some((v) => v.kind === "per_job"));
ok("date reads as words", formatCheckedOn("2026-11-23") === "Nov 23, 2026");

// 2. Wording rules: "typical", never "you will save", no em dashes.
const all = [VENDOR_COSTS_HEAD, ...VENDOR_COSTS.flatMap((v) => [v.job, v.inVacantless, v.typicalPrice, v.vendor])].join(" ");
const noComments = (t: string) => t.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const table = noComments(read("components/vendor-cost-table.tsx") + "\n" + read("lib/vendor-costs.ts"));
ok("never says you will save", !/you will save|you'll save|save you \$/i.test(all + table));
ok("says typical", /typical/i.test(table));
ok("no em dash", !all.includes("\u2014") && !table.includes("\u2014"));
ok("rent collection is not a saving line", !VENDOR_COSTS.some((v) => /rent by|pre-authorized/i.test(v.inVacantless)));

// 3. Shown on both pages.
ok("homepage shows the table", read("app/page.tsx").includes("<VendorCostTable"));
ok("billing page shows the table", read("app/dashboard/billing/page.tsx").includes("<VendorCostTable"));
ok("billing page shows the grouped list", read("app/dashboard/billing/page.tsx").includes("PAID_FEATURE_GROUPS.map"));

// 4. Paid list grouped by job, with the S832 audit fixes.
ok("five job groups", PAID_FEATURE_GROUPS.length === 5);
const paid = PAID_FEATURE_GROUPS.flatMap((g) => g.items).join(" ");
ok("no unproven trade network claim", !/other landlords/i.test(paid));
ok("no bank-feed claim on the paid list", !/from your bank/i.test(paid));
ok("turnover line does not promise ads down without Posting", !/ads down when rented/i.test(paid));
ok("data sheet named on Free and paid", /data sheet/.test(TIERS.free.features.join(" ")) && /data sheet/.test(paid));
ok("lease reading named", /signed lease/.test(paid));
ok("monthly report named", /monthly report/i.test(paid));
const home = read("app/page.tsx");
ok("homepage before/after photos", home.includes("/marketing/touchup-before.jpg") && home.includes("/marketing/touchup-after.jpg"));
ok("homepage touch-up says Drive or Dropbox", /Drive or Dropbox folder come in brighter/.test(home));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
