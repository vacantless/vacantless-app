// Unit tests for the pure rent-roll + cap-rate model. Run: npx tsx scripts/test-rent-roll.ts
import {
  buildRentRoll,
  computeCapRate,
  rangeDays,
  rentRollToCsv,
  rentRollStatusLabel,
  type RentRollPropertyRef,
  type RentRollTenancyInput,
} from "../lib/rent-roll";
import { isOperatingCategory, isFinancingCategory } from "../lib/expenses";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Operating vs financing split (NOI exclusion) ---------------------------
ok("mortgage is financing", isFinancingCategory("mortgage") && !isOperatingCategory("mortgage"));
ok("interest is financing", isFinancingCategory("interest") && !isOperatingCategory("interest"));
ok("property_tax is operating", isOperatingCategory("property_tax"));
ok("utilities is operating", isOperatingCategory("utilities"));
ok("work-order category (plumbing) is operating", isOperatingCategory("plumbing"));
ok("blank category is operating (default true)", isOperatingCategory(""));

// --- Fixtures ---------------------------------------------------------------
// Building A = two units in one building; Building B = a standalone keyless unit.
const props: RentRollPropertyRef[] = [
  { id: "a1", address: "833 Pillette Rd, Unit 1", buildingKey: "833-pillette", askingRentCents: 150000 },
  { id: "a2", address: "833 Pillette Rd, Unit 2", buildingKey: "833-pillette", askingRentCents: 160000 },
  { id: "b1", address: "12 Maple St", buildingKey: null, askingRentCents: 200000 },
];

const tenancies: RentRollTenancyInput[] = [
  // a1: an ended lease + a current active lease — active must win.
  { propertyId: "a1", status: "ended", rentCents: 140000, startDate: "2024-01-01", endDate: "2024-12-31", primaryTenantName: "Old Tenant", coTenantCount: 0 },
  { propertyId: "a1", status: "active", rentCents: 155000, startDate: "2025-06-01", endDate: null, primaryTenantName: "Alice Smith", coTenantCount: 1 },
  // a2: upcoming only -> upcoming status, not in-place.
  { propertyId: "a2", status: "upcoming", rentCents: 162000, startDate: "2026-08-01", endDate: "2027-07-31", primaryTenantName: "Bob Jones", coTenantCount: 0 },
  // b1: no tenancy -> vacant.
];

const roll = buildRentRoll(props, tenancies);

// --- Resolution + status ----------------------------------------------------
const a1 = roll.buildings.flatMap((b) => b.units).find((u) => u.propertyId === "a1")!;
ok("a1 active wins over ended", a1.status === "occupied" && a1.monthlyRentCents === 155000);
ok("a1 tenant label with co-tenant", a1.tenantLabel === "Alice Smith +1 co-tenant");
ok("a1 month-to-month (no end)", a1.leaseEnd === null && a1.leaseStart === "2025-06-01");

const a2 = roll.buildings.flatMap((b) => b.units).find((u) => u.propertyId === "a2")!;
ok("a2 upcoming status", a2.status === "upcoming" && a2.inPlace === false);
ok("a2 uses lease rent", a2.monthlyRentCents === 162000);

const b1 = roll.buildings.flatMap((b) => b.units).find((u) => u.propertyId === "b1")!;
ok("b1 vacant", b1.status === "vacant" && b1.tenantLabel === null && b1.inPlace === false);
ok("b1 vacant shows asking rent", b1.monthlyRentCents === 200000);

// --- Grouping + totals ------------------------------------------------------
ok("two building groups (A + standalone B)", roll.buildings.length === 2);
const bldgA = roll.buildings.find((b) => b.buildingKey === "833-pillette")!;
ok("building A label is street", bldgA.label === "833 Pillette Rd");
ok("building A has 2 units", bldgA.unitCount === 2 && bldgA.occupiedCount === 1);
ok("building A in-place monthly = a1 only", bldgA.inPlaceMonthlyRentCents === 155000);
ok("building A annual = monthly x12", bldgA.inPlaceAnnualRentCents === 155000 * 12);

ok("portfolio totals: 3 units", roll.totalUnits === 3);
ok("portfolio occupied=1 upcoming=1 vacant=1", roll.occupiedUnits === 1 && roll.upcomingUnits === 1 && roll.vacantUnits === 1);
ok("portfolio in-place monthly = a1 only", roll.inPlaceMonthlyRentCents === 155000);
ok("portfolio annual in-place", roll.inPlaceAnnualRentCents === 155000 * 12);
ok("occupancy pct = 33", roll.occupancyPct === 33);

ok("empty rent roll safe", (() => { const r = buildRentRoll([], []); return r.totalUnits === 0 && r.occupancyPct === 0 && r.buildings.length === 0; })());

// --- rangeDays --------------------------------------------------------------
ok("rangeDays full year inclusive = 365", rangeDays("2026-01-01", "2026-12-31") === 365);
ok("rangeDays single day = 1", rangeDays("2026-06-01", "2026-06-01") === 1);
ok("rangeDays open = null", rangeDays(null, "2026-12-31") === null && rangeDays("2026-01-01", null) === null);
ok("rangeDays reversed = null", rangeDays("2026-12-31", "2026-01-01") === null);

// --- computeCapRate ---------------------------------------------------------
// Annual income $18,600 (a1 155000c x12 = 1,860,000c). Operating expenses over a
// full year = $6,000 (600000c). Value $300,000 (30,000,000c).
const cap = computeCapRate({
  annualOperatingIncomeCents: 1_860_000,
  operatingExpensesCents: 600_000,
  windowDays: 365,
  propertyValueCents: 30_000_000,
});
ok("cap: full-year window not annualized", cap.annualized === false && cap.annualOperatingExpensesCents === 600_000);
ok("cap: NOI = income - opex", cap.noiCents === 1_260_000);
ok("cap: cap rate = NOI/value", cap.capRatePct === 4.2); // 1,260,000 / 30,000,000 = 4.2%
ok("cap: GRM = value/income", cap.grossRentMultiplier === round2(30_000_000 / 1_860_000));

// Half-year window annualizes the opex upward.
const capHalf = computeCapRate({
  annualOperatingIncomeCents: 1_860_000,
  operatingExpensesCents: 300_000,
  windowDays: 182,
  propertyValueCents: 30_000_000,
});
ok("cap: half-year annualizes opex", capHalf.annualized === true && capHalf.annualOperatingExpensesCents === Math.round(300_000 * (365 / 182)));

// No value -> no cap rate / GRM, but NOI still computes.
const capNoValue = computeCapRate({
  annualOperatingIncomeCents: 1_860_000,
  operatingExpensesCents: 600_000,
  windowDays: 365,
  propertyValueCents: null,
});
ok("cap: null value -> null cap rate + GRM", capNoValue.capRatePct === null && capNoValue.grossRentMultiplier === null);
ok("cap: null value still has NOI", capNoValue.noiCents === 1_260_000);

// Zero value treated as no value.
ok("cap: zero value -> null cap rate", computeCapRate({ annualOperatingIncomeCents: 100, operatingExpensesCents: 0, windowDays: 365, propertyValueCents: 0 }).capRatePct === null);

// Open window (all-time) is taken as already annual.
ok("cap: open window not annualized", computeCapRate({ annualOperatingIncomeCents: 100, operatingExpensesCents: 50, windowDays: null, propertyValueCents: 1000 }).annualized === false);

// Negative NOI -> negative cap rate (over-leveraged on operating costs).
ok("cap: negative NOI allowed", computeCapRate({ annualOperatingIncomeCents: 100_000, operatingExpensesCents: 200_000, windowDays: 365, propertyValueCents: 1_000_000 }).noiCents === -100_000);

// --- Labels + CSV -----------------------------------------------------------
ok("status label occupied", rentRollStatusLabel("occupied") === "Occupied");
ok("status label passthrough", rentRollStatusLabel("zzz") === "zzz");

const csv = rentRollToCsv(roll, {
  expensePeriod: "Jan 1 to Dec 31, 2026",
  propertyValueCents: 30_000_000,
  operatingExpensesCents: 600_000,
  cap,
});
ok("csv has rent roll header", csv.startsWith("Rent roll"));
ok("csv has building subtotal row", csv.includes("833 Pillette Rd,") && csv.includes("1/2 occupied"));
ok("csv has TOTAL in-place", csv.includes("TOTAL (in-place)"));
ok("csv has NOI + cap rate", csv.includes("Net operating income (NOI, annual)") && csv.includes("Cap rate,4.2%"));
ok("csv notes financing exclusion", csv.includes("NOI excludes financing"));
ok("csv vacant unit blank lease end", csv.includes("12 Maple St,—,Vacant,,,2000.00"));

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

console.log(`\nrent-roll: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
