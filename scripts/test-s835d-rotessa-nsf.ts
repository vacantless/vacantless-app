// S835d: failed Rotessa rent debits become NSF charges.
// Run: npx tsx scripts/test-s835d-rotessa-nsf.ts
import { readFileSync } from "node:fs";
import {
  ROTESSA_NSF_FEE_CENTS,
  ROTESSA_NSF_HOURS,
  ROTESSA_NSF_LOOKBACK_DAYS,
  isFailedRotessaTransaction,
  isoDaysAgo,
  rotessaAmountCents,
  rotessaNsfDate,
  rotessaNsfDue,
  rotessaNsfNote,
  rotessaNsfRef,
} from "../lib/rotessa-nsf";
import { ROTESSA } from "../lib/rent-rail-costs";
import { rentFailedEmail } from "../lib/rent-failed";
import { CATALOG_MESSAGES } from "../lib/message-catalog";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

ok("the Rotessa fee comes from the one price file", ROTESSA_NSF_FEE_CENTS === ROTESSA.nsfCents && ROTESSA_NSF_FEE_CENTS === 3000);
ok("declined counts as failed", isFailedRotessaTransaction({ status: "Declined" }));
ok("a chargeback counts as failed", isFailedRotessaTransaction({ status: "Chargeback" }));
ok("approved, pending and future do not", !isFailedRotessaTransaction({ status: "Approved" }) && !isFailedRotessaTransaction({ status: "Pending" }) && !isFailedRotessaTransaction({ status: "Future" }) && !isFailedRotessaTransaction({ status: null }));
// S835e: Rotessa's screens show the reason ("NSF") as the status.
ok("a status of NSF counts as failed", isFailedRotessaTransaction({ status: "NSF" }));
ok("an unknown status with a failure reason counts", isFailedRotessaTransaction({ status: "Returned", statusReason: "Account Closed" }));
ok("an unknown status with no reason does not", !isFailedRotessaTransaction({ status: "Returned", statusReason: "" }));
ok("an approved payment with a stray reason does not", !isFailedRotessaTransaction({ status: "Approved", statusReason: "NSF" }));
ok("the reference names the transaction", rotessaNsfRef(" 12345 ") === "rotessa:12345");
ok("the note carries Rotessa's reason", rotessaNsfNote("NSF") === "Rotessa's fee for the failed bank debit (NSF)." && rotessaNsfNote(null) === "Rotessa's fee for the failed bank debit.");
ok("the date is the process date", rotessaNsfDate("2026-12-01", "2026-12-04") === "2026-12-01" && rotessaNsfDate("2026-12-01T00:00:00.000-06:00", "2026-12-04") === "2026-12-01");
ok("no process date falls back to today", rotessaNsfDate(null, "2026-12-04") === "2026-12-04" && rotessaNsfDate("soon", "2026-12-04") === "2026-12-04");
ok("amounts read as cents", rotessaAmountCents("1250.00") === 125000 && rotessaAmountCents("1,250.5") === 125050 && rotessaAmountCents("abc") === null && rotessaAmountCents(null) === null);
ok("the read looks back two weeks", ROTESSA_NSF_LOOKBACK_DAYS === 14 && isoDaysAgo("2026-12-04", 14) === "2026-11-20" && isoDaysAgo("2026-01-05", 14) === "2025-12-22");
ok("it runs three times a day", ROTESSA_NSF_HOURS.length === 3 && rotessaNsfDue(8) && rotessaNsfDue(14) && rotessaNsfDue(20) && !rotessaNsfDue(9) && !rotessaNsfDue(0));

const mail = rentFailedEmail({ tenantName: "Sam Lee", address: "12 Main St", amountLabel: "$1,500", rail: "rotessa" });
ok("the Rotessa email names the $30 fee", /Rotessa bills you \$30 for an NSF or stopped payment/.test(mail.body));
ok("the Rotessa email makes no Stripe claim", !/Stripe/.test(mail.body));
ok("the Stripe email is unchanged", /Stripe may try the debit again/.test(rentFailedEmail({ tenantName: "Sam", address: null, amountLabel: null }).body));
ok("no em dash", !/—/.test(mail.subject + mail.body));

const row = CATALOG_MESSAGES.find((m) => m.id === "you-rent-failed");
ok("Every message we send says Rotessa is checked too", !!row && /Rotessa is checked three times a day/.test(row.when));

const server = readFileSync("lib/rotessa-nsf-server.ts", "utf8");
ok("only linked tenancies are read", /not\("rotessa_customer_id", "is", null\)/.test(server));
ok("one charge per transaction", /external_ref: rotessaNsfRef\(txn\.id\)/.test(server) && /23505"\) continue/.test(server));
ok("a customer on two tenancies is left alone", /counts\.get\(t\.rotessa_customer_id!\) === 1/.test(server));
ok("the fee is an expense with Rotessa as merchant", /merchant: "Rotessa"/.test(server) && /amount_cents: ROTESSA_NSF_FEE_CENTS/.test(server));
ok("the owners are emailed through the one sender", /notifyRentPaymentFailed\(admin, t\.id, [\s\S]{0,60}"rotessa"\)/.test(server) && !/sendNotificationEmail/.test(server));
ok("nothing is written at Rotessa", !/"(POST|PATCH|DELETE)"/.test(server) && /fetchTransactionReport\(/.test(server));
ok("an unreadable report is a failed sweep", /report\.ok\) \{[\s\S]{0,80}out\.ok = false/.test(server));

const route = readFileSync("app/api/cron/rent-stop/route.ts", "utf8");
ok("the rent sweep runs the Rotessa read in its hours", /rotessaNsfDue\(hour\)/.test(route) && /runRotessaNsfSweep\(/.test(route));
ok("the route still needs the cron secret", /CRON_SECRET/.test(route) && route.indexOf("authorized(req)") < route.indexOf("runRotessaNsfSweep("));

const sql = readFileSync("supabase/migrations/0326_nsf_charge_external_ref.sql", "utf8").replace(/^--.*$/gm, "");
ok("0326 only adds", /add column if not exists external_ref text/.test(sql) && /create unique index if not exists/.test(sql) && !/\bdrop\b|\bdelete\b/i.test(sql));

console.log(`\ns835d rotessa nsf: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
