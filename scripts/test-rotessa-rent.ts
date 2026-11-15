// S798: unit tests for lib/rotessa-rent-plan.ts (pure Rotessa rent helpers).
// Run: npx tsx scripts/test-rotessa-rent.ts
import {
  dollarsToCents,
  toIsoDay,
  parseCustomer,
  parseCustomerList,
  pickCustomerByEmail,
  scheduleToLink,
  summarizeRotessaRent,
  paymentState,
  decideRotessaScheduledStop,
} from "../lib/rotessa-rent-plan";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.log("FAIL:", name);
  }
}

ok("dollarsToCents string", dollarsToCents("1250.00") === 125000);
ok("dollarsToCents number", dollarsToCents(5) === 500);
ok("dollarsToCents junk", dollarsToCents("abc") === null);
ok("toIsoDay iso", toIsoDay("2026-12-01") === "2026-12-01");
ok("toIsoDay iso with time", toIsoDay("2026-12-01T00:00:00.000-05:00") === "2026-12-01");
ok("toIsoDay long", toIsoDay("December 1, 2026") === "2026-12-01");
ok("toIsoDay bad", toIsoDay("soon") === null);

const raw = {
  id: 664477,
  name: "Test Tenant - Stripe Rail",
  email: "Stripe-Rail-Test@Example.com",
  active: true,
  custom_identifier: "5df109e7",
  transaction_schedules: [
    { id: 9001, amount: "2620.00", frequency: "Monthly", process_date: "2026-10-01", next_process_date: "2026-12-01", installments: null },
  ],
  financial_transactions: [
    { amount: "2620.00", status: "Approved", process_date: "2026-10-01", transaction_schedule_id: 9001 },
    { amount: "2620.00", status: "Pending", process_date: "2026-11-01", transaction_schedule_id: 9001 },
    { amount: "2620.00", status: "Future", process_date: "2026-12-01", transaction_schedule_id: 9001 },
  ],
};
const c = parseCustomer(raw)!;
ok("parseCustomer id as string", c.id === "664477");
ok("parseCustomer schedule", c.schedules.length === 1 && c.schedules[0].id === "9001");
ok("parseCustomer schedule amount", c.schedules[0].amountCents === 262000);
ok("parseCustomer active", c.active === true);
ok("parseCustomer archived", parseCustomer({ id: 1, active: false })!.active === false);
ok("parseCustomer no id -> null", parseCustomer({ name: "x" }) === null);
ok("parseCustomerList non-array", parseCustomerList({}).length === 0);

const list = parseCustomerList([
  raw,
  { id: 2, email: "dup@x.com", active: true },
  { id: 3, email: "dup@x.com", active: true },
  { id: 4, email: "old@x.com", active: false },
  { id: 5, email: "dup2@x.com", active: false },
  { id: 6, email: "dup2@x.com", active: true },
]);
const p1 = pickCustomerByEmail(list, "  stripe-rail-test@example.com ");
ok("pick by email, case-insensitive", p1.ok && p1.customer.id === "664477");
const p2 = pickCustomerByEmail(list, "dup@x.com");
ok("pick refuses two active", !p2.ok && p2.code === "many");
const p3 = pickCustomerByEmail(list, "old@x.com");
ok("pick refuses archived only", !p3.ok && p3.code === "archived");
const p4 = pickCustomerByEmail(list, "dup2@x.com");
ok("pick ignores archived duplicate", p4.ok && p4.customer.id === "6");
const p5 = pickCustomerByEmail(list, "nobody@x.com");
ok("pick no match", !p5.ok && p5.code === "nomatch");
const p6 = pickCustomerByEmail(list, "not an email");
ok("pick bad email", !p6.ok && p6.code === "bademail");

ok("scheduleToLink one", scheduleToLink(c) === "9001");
ok("scheduleToLink none", scheduleToLink(parseCustomer({ id: 1 })!) === null);
ok(
  "scheduleToLink two -> null",
  scheduleToLink(parseCustomer({ id: 1, transaction_schedules: [{ id: 1 }, { id: 2 }] })!) === null,
);

ok("paymentState approved", paymentState("Approved") === "paid");
ok("paymentState pending", paymentState("Pending") === "processing");
ok("paymentState declined", paymentState("Declined") === "failed");
ok("paymentState future", paymentState("Future") === null);

const s = summarizeRotessaRent(c, "9001");
ok("summary amount", s.amountCents === 262000);
ok("summary next", s.nextChargeIso === "2026-12-01");
ok("summary last is the pending one", s.lastPaymentIso === "2026-11-01" && s.lastPaymentState === "processing");
ok("summary anchor day", s.anchorDay === 1);
ok("summary found", s.scheduleFound === true);
const sGone = summarizeRotessaRent(c, "1234");
ok("summary missing schedule", sGone.scheduleFound === false && sGone.nextChargeIso === null);
ok("summary null customer", summarizeRotessaRent(null, "9001").scheduleFound === false);

const base = { stopAfterIso: "2026-12-01", scheduleFound: true };
ok("stop: none", decideRotessaScheduledStop({ ...base, stopAfterIso: null, todayIso: "2026-12-05", nextChargeIso: "2027-01-01" }).reason === "none");
ok("stop: before date", decideRotessaScheduledStop({ ...base, todayIso: "2026-11-20", nextChargeIso: "2027-01-01" }).stop === false);
ok("stop: waiting while next is the last payment", decideRotessaScheduledStop({ ...base, todayIso: "2026-12-01", nextChargeIso: "2026-12-01" }).reason === "waiting");
ok("stop: taken once next moves past", decideRotessaScheduledStop({ ...base, todayIso: "2026-12-02", nextChargeIso: "2027-01-01" }).reason === "taken");
ok("stop: grace after 14 days", decideRotessaScheduledStop({ ...base, todayIso: "2026-12-15", nextChargeIso: "2026-12-01" }).reason === "grace");
ok("stop: schedule gone", decideRotessaScheduledStop({ ...base, scheduleFound: false, todayIso: "2026-11-01", nextChargeIso: null }).reason === "gone");

console.log(`\nrotessa-rent: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
