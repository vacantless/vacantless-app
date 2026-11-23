// S836a (REVIEW-S835 finding 11): a monthly report that nobody received is
// retried on the next sweep, and the sweep says it failed.
// Run: npx tsx scripts/test-s836a-report-retry.ts
import { readFileSync } from "node:fs";
import { reportSendOutcome } from "../lib/rental-report";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}

ok("all sent", reportSendOutcome(2, 2) === "sent");
ok("one of one", reportSendOutcome(1, 1) === "sent");
ok("none sent is failed", reportSendOutcome(1, 0) === "failed");
ok("none of two is failed", reportSendOutcome(2, 0) === "failed");
ok("one of two is partial", reportSendOutcome(2, 1) === "partial");
ok("no recipients", reportSendOutcome(0, 0) === "no_recipient");

const cron = readFileSync("app/api/cron/rental-report/route.ts", "utf8");
ok("still claims before sending", cron.indexOf("rental_report_sent_month.neq.") < cron.indexOf("sendRentalReportEmail({"));
ok("uses the outcome rule", cron.includes("reportSendOutcome(to.length, delivered)"));
ok("hands the month back only on failed", /outcome === "failed"\)\s*\{[\s\S]*?rental_report_sent_month: p\.rental_report_sent_month/.test(cron));
ok("hand-back is guarded on the claim", cron.includes('.eq("rental_report_sent_month", range.key)'));
ok("keeps the send reason", cron.includes("else if (!why) why = res.reason"));
ok("sweep answers ok:false when one is not sent", /if \(failed\.length\)[\s\S]*?ok: false/.test(cron));
ok("dry run never claims or sends", cron.indexOf("if (dry) continue;") < cron.indexOf("rental_report_sent_month: range.key"));
ok("no em dash in the route", !cron.includes("—"));

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
