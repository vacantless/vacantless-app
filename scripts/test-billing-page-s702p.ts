// Run with: npx tsx scripts/test-billing-page-s702p.ts
// S702p: billing page shows only what is on sale, and a canceled plan can restart.
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error(`FAIL: ${n}`)));
const s = readFileSync("app/dashboard/billing/page.tsx", "utf8");
ok("Managed hidden unless on it", s.includes('(key !== "managed" || (conciergeDeskEnabled && org?.plan === "managed"))'));
ok("Premium hidden unless on it", s.includes('(key !== "premium" || org?.plan === "premium")'));
ok("canceled is not current", s.includes("view.isPaid && !subscriptionEnded"));
ok("restart button", s.includes("`Restart ${tier.name}`"));
ok("grid follows visible cards", s.includes('visibleTierKeys.length > 3 ? "xl:grid-cols-4"'));
console.log(`\nbilling-page-s702p: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
