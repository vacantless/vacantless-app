// Unit tests for the pure N4 arrears + termination-date logic (Slice A).
// Run: npx tsx scripts/test-n4.ts
import {
  addDaysISO,
  deriveN4Arrears,
  deriveN4TerminationDate,
  minN4NoticeDays,
  monthlyPeriodKeys,
  resolveN4OwingCents,
  type RentPeriodUnit,
} from "../lib/n4";
import type { PaymentRow } from "../lib/payments";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}
function eq<T>(got: T, want: T, msg: string): void {
  ok(
    JSON.stringify(got) === JSON.stringify(want),
    `${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

// --- addDaysISO -------------------------------------------------------------
eq(addDaysISO("2026-07-12", 14), "2026-07-26", "add 14 within month");
eq(addDaysISO("2026-07-25", 14), "2026-08-08", "add 14 across month");
eq(addDaysISO("2026-12-28", 7), "2027-01-04", "add 7 across year");
eq(addDaysISO("2028-02-27", 2), "2028-02-29", "leap day");
eq(addDaysISO("2027-02-27", 2), "2027-03-01", "non-leap Feb rolls to Mar");

// --- minimum notice + termination date --------------------------------------
eq(minN4NoticeDays("monthly"), 14, "monthly => 14");
eq(minN4NoticeDays("yearly"), 14, "yearly => 14");
eq(minN4NoticeDays("weekly"), 7, "weekly => 7");
eq(minN4NoticeDays("daily"), 7, "daily => 7");
eq(
  deriveN4TerminationDate("2026-07-12", "monthly"),
  "2026-07-26",
  "monthly termination = service + 14",
);
eq(
  deriveN4TerminationDate("2026-07-12", "weekly"),
  "2026-07-19",
  "weekly termination = service + 7",
);
// The termination date need NOT be a period end (14 days can land mid-month).
for (const u of ["daily", "weekly", "monthly", "yearly"] as RentPeriodUnit[]) {
  ok(
    deriveN4TerminationDate("2026-07-12", u) > "2026-07-12",
    `${u} termination is strictly after service`,
  );
}

// --- monthlyPeriodKeys ------------------------------------------------------
eq(
  monthlyPeriodKeys("2026-05-15", "2026-07-01"),
  ["2026-05-01", "2026-06-01", "2026-07-01"],
  "3-month window (normalizes day to 01)",
);
eq(monthlyPeriodKeys("2026-07-10", "2026-07-31"), ["2026-07-01"], "single month");
eq(
  monthlyPeriodKeys("2026-11-01", "2027-02-01"),
  ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"],
  "crosses year boundary",
);
eq(monthlyPeriodKeys("2026-08-01", "2026-07-01"), [], "reversed => empty");
eq(monthlyPeriodKeys("nonsense", "2026-07-01"), [], "bad input => empty");

// --- deriveN4Arrears --------------------------------------------------------
const RENT = 220000; // $2,200.00

// (a) Three unpaid months => full arrears.
{
  const a = deriveN4Arrears({
    rentCents: RENT,
    startDateISO: "2026-05-01",
    asOfISO: "2026-07-12",
    payments: [],
  });
  eq(a.rows.length, 3, "3 due periods");
  eq(a.totalChargedCents, 3 * RENT, "charged = 3 * rent");
  eq(a.totalPaidCents, 0, "nothing paid");
  eq(a.computedOwingCents, 3 * RENT, "owe all three");
  eq(a.rows[0].label, "May 2026", "first row labeled");
}

// (b) Partial: May paid in full, June half, July nothing.
{
  const payments: PaymentRow[] = [
    { amount_cents: RENT, period_month: "2026-05-01" },
    { amount_cents: 110000, period_month: "2026-06-01" },
  ];
  const a = deriveN4Arrears({
    rentCents: RENT,
    startDateISO: "2026-05-01",
    asOfISO: "2026-07-12",
    payments,
  });
  eq(a.totalPaidCents, RENT + 110000, "paid May full + June half");
  eq(a.computedOwingCents, 3 * RENT - (RENT + 110000), "owe June half + July full");
  eq(a.rows[1].owingCents, 110000, "June owes half");
  eq(a.rows[2].owingCents, RENT, "July owes full");
}

// (c) Fully paid => zero owing (never negative).
{
  const payments: PaymentRow[] = [
    { amount_cents: RENT, period_month: "2026-06-01" },
    { amount_cents: RENT, period_month: "2026-07-15" }, // day normalizes to 07-01
  ];
  const a = deriveN4Arrears({
    rentCents: RENT,
    startDateISO: "2026-06-01",
    asOfISO: "2026-07-12",
    payments,
  });
  eq(a.computedOwingCents, 0, "paid in full => 0 owing");
}

// (d) Overpaid one month nets against the window but floors at 0.
{
  const payments: PaymentRow[] = [
    { amount_cents: RENT * 3, period_month: "2026-06-01" }, // triple-paid June
  ];
  const a = deriveN4Arrears({
    rentCents: RENT,
    startDateISO: "2026-06-01",
    asOfISO: "2026-07-12",
    payments,
  });
  eq(a.rows[0].owingCents, -2 * RENT, "June overpaid shows negative row");
  eq(a.computedOwingCents, 0, "net credit floors owing at 0");
}

// (e) Unassigned + out-of-window payments are surfaced, NOT applied.
{
  const payments: PaymentRow[] = [
    { amount_cents: 50000, period_month: null }, // unassigned
    { amount_cents: 90000, period_month: "2026-01-01" }, // before window
  ];
  const a = deriveN4Arrears({
    rentCents: RENT,
    startDateISO: "2026-06-01",
    asOfISO: "2026-07-12",
    payments,
  });
  eq(a.unassignedPaidCents, 50000, "unassigned surfaced");
  eq(a.outOfWindowPaidCents, 90000, "out-of-window surfaced");
  eq(a.totalPaidCents, 0, "neither applied to the window total");
  eq(a.computedOwingCents, 2 * RENT, "owing unaffected by unapplied credits");
}

// (f) firstPeriodISO caps the lookback.
{
  const a = deriveN4Arrears({
    rentCents: RENT,
    startDateISO: "2026-01-01",
    asOfISO: "2026-07-12",
    payments: [],
    firstPeriodISO: "2026-06-01",
  });
  eq(a.rows.length, 2, "cap => only June + July");
  eq(a.computedOwingCents, 2 * RENT, "cap => 2 months owing");
}

// --- resolveN4OwingCents ----------------------------------------------------
eq(resolveN4OwingCents(300000, null), 300000, "no override => computed");
eq(resolveN4OwingCents(300000, undefined), 300000, "undefined override => computed");
eq(resolveN4OwingCents(300000, 250000), 250000, "override wins (down)");
eq(resolveN4OwingCents(300000, 0), 0, "override to 0 is honored");
eq(resolveN4OwingCents(300000, -5), 300000, "negative override ignored => computed");

console.log(`test-n4: ${pass}/${fail}`);
if (fail > 0) process.exit(1);
