// Run with: npx tsx scripts/test-books-growth.ts
// S760 (Noam, 2026-11-06): Books & Tax is part of Growth, not a paid add-on.
// The books part of Money opens for Growth and every plan with accounting.
import { readFileSync, existsSync } from "node:fs";
import { canUseBooks, TIERS, postingAddonOffer } from "../lib/billing";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- 1. The gate -------------------------------------------------------------
ok("growth = yes", canUseBooks({ plan: "growth" }));
ok("premium = yes", canUseBooks({ plan: "premium" }));
ok("managed = yes", canUseBooks({ plan: "managed" }));
ok("pilot = yes", canUseBooks({ plan: "pilot" }));
ok("free = no", !canUseBooks({ plan: "free" }));
ok("trial = no", !canUseBooks({ plan: "trial" }));
ok("legacy core = no", !canUseBooks({ plan: "core" }));
ok("legacy plus = no", !canUseBooks({ plan: "plus" }));
ok("unknown = no", !canUseBooks({ plan: "bogus" }));
ok("null plan = no", !canUseBooks({ plan: null }));
ok("null org = no", !canUseBooks(null));

// --- 2. Copy: Growth sells it, Premium no longer claims books or dispatch ------
const growth = TIERS.growth.features.join(" ");
ok("growth lists Books & Tax", /Books & Tax/.test(growth) && /T776/.test(growth));
ok("growth still sells repairs with trades", /trade/.test(growth));
const prem = [TIERS.premium.blurb, ...TIERS.premium.features].join(" ");
ok("premium no longer sells dispatch", !/dispatch|repair coordination/i.test(prem));
ok("premium no longer claims books", !/books|accounting/i.test(prem));
ok("no em dash in plan copy", ![growth, prem].join(" ").includes("—"));
ok("no parentheses in plan copy", !/[()]/.test([growth, prem].join(" ")));

// Posting offer unchanged (no add-on rework in this pass).
ok("posting: free with a live sub still needs growth", postingAddonOffer({ priceConfigured: true, plan: "free", addonActive: false, addonItemId: null, hasSubscription: true, subscriptionStatus: "active" }) === "needs_growth");

// --- 3. Wiring: every books surface goes through canUseBooks --------------------
const GATED = [
  "app/dashboard/money/page.tsx",
  "app/dashboard/money/tax-package/page.tsx",
  "app/dashboard/money/tax-package/export/route.ts",
  "app/dashboard/money/income-statement/page.tsx",
  "app/dashboard/money/income-statement/export/route.ts",
  "app/dashboard/money/import-history/page.tsx",
  "app/dashboard/money/import-history/actions.ts",
  "app/dashboard/money/reconcile/page.tsx",
  "app/dashboard/money/reconcile/actions.ts",
  "app/dashboard/money/spend/page.tsx",
  "app/dashboard/money/investment-package/page.tsx",
  "app/dashboard/money/investment-package/export/route.ts",
  "app/dashboard/money/accountant-package/page.tsx",
  "app/dashboard/money/accountant-package/export/route.ts",
  "app/dashboard/rent/rent-roll/page.tsx",
  "app/dashboard/rent/rent-roll/export/route.ts",
  "app/dashboard/rent/statement/page.tsx",
];
for (const f of GATED) {
  const src = read(f);
  ok(`${f} uses canUseBooks`, src.includes("canUseBooks(org)"));
  ok(`${f} has no plan-only accounting gate`, !/planEntitlements\(org\.plan\)\.accounting|hasEntitlement\(org\.plan, "accounting"\)/.test(src));
  ok(`${f} no Premium upsell`, !/Premium feature|Upgrade to Premium/.test(src));
  ok(`${f} no add-on leftovers`, !/books-addon|Books & Tax add-on|orgCanUseBooks/.test(src));
}
const lockPages = GATED.filter((f) => f.endsWith("page.tsx") && !f.endsWith("money/page.tsx") && !f.endsWith("statement/page.tsx"));
for (const f of lockPages) {
  ok(`${f} lock names the paid plans (S779)`, read(f).includes("Part of Starter and up, from $29 a month"));
}

// --- 4. Nothing of the add-on is left ------------------------------------------
ok("bank feed routing untouched", !read("lib/bank-feed/index.ts").includes("canUseBooks"));
ok("no books add-on migration", !existsSync("supabase/migrations/0274_books_addon.sql"));
ok("no books-access module", !existsSync("lib/books-access.ts"));
for (const f of ["lib/billing.ts", "lib/stripe.ts", "app/api/stripe/webhook/route.ts", "app/dashboard/billing/actions.ts", "app/dashboard/billing/page.tsx", "app/page.tsx"]) {
  ok(`${f} has no books add-on`, !/BOOKS_ADDON|booksAddon|books_addon|books-addon/.test(read(f)));
}
ok("dispatch lock line names the plans (S779)", read("lib/work-order-dispatch.ts").includes("Sending a job to a trade comes with Starter and up."));

console.log(`\nbooks-growth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
