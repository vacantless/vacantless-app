// Run: npx tsx scripts/test-sms-limit.ts
import { SMS_MONTHLY_LIMIT, logTextSent, monthlyTextCount, overMonthlyTextLimit, textsSentThisMonth, torontoMonthStartIso } from "../lib/sms-limit";
import { readFileSync } from "node:fs";
let passed = 0, failed = 0;
const ok = (n: string, c: boolean) => { if (c) passed++; else { failed++; console.error("  X " + n); } };
ok("limit is 500", SMS_MONTHLY_LIMIT === 500);
ok("under the limit sends", !overMonthlyTextLimit(499));
ok("at the limit stops", overMonthlyTextLimit(500));
ok("bad count never blocks", !overMonthlyTextLimit(Number.NaN));
ok("Oct 20 -> Oct 1", torontoMonthStartIso(new Date("2026-10-20T15:00:00Z")) === "2026-10-01T05:00:00.000Z");
ok("Nov 1 00:30 Toronto is November", torontoMonthStartIso(new Date("2026-11-01T04:30:00Z")) === "2026-11-01T05:00:00.000Z");
ok("Oct 31 23:30 Toronto is still October", torontoMonthStartIso(new Date("2026-11-01T03:30:00Z")) === "2026-10-01T05:00:00.000Z");

// S777 (KI1549): the month counts sms_sends too; the larger count wins.
ok("larger count wins", monthlyTextCount(11, 14) === 14 && monthlyTextCount(14, 0) === 14);
ok("bad counts are 0", monthlyTextCount(Number.NaN, 3) === 3);
function fakeAdmin(counts: Record<string, number | "error">, inserts: unknown[]) {
  return {
    from(table: string) {
      const q: any = {
        select: () => q, eq: () => q, gte: () => q,
        insert: (row: unknown) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
        then: (res: any, rej: any) => Promise.resolve(counts[table] === "error" ? { count: null, error: { message: "no table" } } : { count: counts[table] ?? 0, error: null }).then(res, rej),
      };
      return q;
    },
  };
}
async function main() {
const ins: unknown[] = [];
const sends = await textsSentThisMonth(fakeAdmin({ messages: 11, sms_sends: 15 }, ins), "org");
ok("counts the alerts in sms_sends", sends === 15);
const before = await textsSentThisMonth(fakeAdmin({ messages: 11, sms_sends: "error" }, ins), "org");
ok("table missing still counts messages", before === 11);
await logTextSent(fakeAdmin({}, ins), "org");
ok("logs one row for the org", JSON.stringify(ins) === JSON.stringify([{ table: "sms_sends", row: { organization_id: "org" } }]));
await logTextSent(null, "org");
ok("no client, no throw", true);
const smsSrc = readFileSync("lib/sms.ts", "utf8");
ok("sendSms logs only after Twilio accepts", /if \(result\.sent\)[\s\S]{0,300}logTextSent/.test(smsSrc));
console.log(`\nsms-limit: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
