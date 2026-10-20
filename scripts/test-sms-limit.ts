// Run: npx tsx scripts/test-sms-limit.ts
import { SMS_MONTHLY_LIMIT, overMonthlyTextLimit, torontoMonthStartIso } from "../lib/sms-limit";
let passed = 0, failed = 0;
const ok = (n: string, c: boolean) => { if (c) passed++; else { failed++; console.error("  X " + n); } };
ok("limit is 500", SMS_MONTHLY_LIMIT === 500);
ok("under the limit sends", !overMonthlyTextLimit(499));
ok("at the limit stops", overMonthlyTextLimit(500));
ok("bad count never blocks", !overMonthlyTextLimit(Number.NaN));
ok("Oct 20 -> Oct 1", torontoMonthStartIso(new Date("2026-10-20T15:00:00Z")) === "2026-10-01T05:00:00.000Z");
ok("Nov 1 00:30 Toronto is November", torontoMonthStartIso(new Date("2026-11-01T04:30:00Z")) === "2026-11-01T05:00:00.000Z");
ok("Oct 31 23:30 Toronto is still October", torontoMonthStartIso(new Date("2026-11-01T03:30:00Z")) === "2026-10-01T05:00:00.000Z");
console.log(`\nsms-limit: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
