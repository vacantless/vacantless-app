// S832: the "pays for itself" table and the grouped paid-plan list.
// Run: npx tsx scripts/test-s832-vendor-costs.ts
import { readFileSync } from "node:fs";
import { VENDOR_COSTS, VENDOR_COSTS_HEAD, USD_CAD, cadPriceText, exampleText, formatCheckedOn, monthlySubtotalCad, toCad } from "../lib/vendor-costs";
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
ok("eight vendor lines", VENDOR_COSTS.length === 8);
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
// S834a: a rent line is allowed only when it says the payment fee still applies.
ok(
  "rent line names the payment fee",
  VENDOR_COSTS.filter((v) => /rent by/i.test(v.inVacantless)).every((v) => /payment fee still applies/i.test(v.inVacantless)),
);

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
ok("homepage touch-up names uploads and folders", /upload or pull from your Drive or Dropbox folder come in brighter/.test(home));

// 5. S832c: one Canadian-dollar price, a monthly subtotal, one worked example.
for (const v of VENDOR_COSTS) {
  const shown = v.typicalPrice.replace(/,/g, "");
  ok(`${v.job}: numbers match the shown price`, shown.includes(`$${v.amount.low}`) && (v.amount.high == null || shown.includes(`$${v.amount.high}`)));
  ok(`${v.job}: CAD text names its unit`, /^(about )?CA\$\d+( to CA\$\d+)? (a month|an hour|a notice|a photo)$/.test(cadPriceText(v)));
}
ok("rate dated", /^\d{4}-\d{2}-\d{2}$/.test(USD_CAD.date) && USD_CAD.rate > 1 && USD_CAD.rate < 2);
ok("toCad USD", Math.abs(toCad(10, "USD") - 14.325) < 1e-9);
ok("toCad CAD unchanged", toCad(13, "CAD") === 13);
const sub = monthlySubtotalCad();
ok("subtotal low = 14.33 + 21.49 + 13 + 30 + 17.19 = 96", sub.low === 96);
ok("subtotal high = 14.33 + 27.22 + 13 + 30 + 17.19 = 102", sub.high === 102);
ok("posting help reads per hour", cadPriceText(VENDOR_COSTS.find((v) => v.kind === "per_job")!) === "about CA$14 to CA$29 an hour");
ok("only the photo line has an example", VENDOR_COSTS.filter((v) => v.example).length === 1 && Boolean(VENDOR_COSTS.find((v) => v.example)?.job.includes("photo")));
ok("photo example text", exampleText(VENDOR_COSTS.find((v) => v.example)!) === "a 20-photo listing: about CA$57");
const comp = read("components/vendor-cost-table.tsx");
ok("per-job lines never summed", !/perJob\.reduce|monthlySubtotalCad\(perJob/.test(comp));
ok("subtotal shown beside Starter", comp.includes("These apps together") && comp.includes("starterPrice"));
ok("no average word on the page", !/average/i.test(noComments(comp)));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
