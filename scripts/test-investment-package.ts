// Unit tests for the investment package. It is read by a BUYER, so most of these
// are about what it REFUSES to publish.
// Run: npx tsx scripts/test-investment-package.ts
import {
  buildInvestmentPackage,
  investmentPackageToCsv,
  wholeMonthsBetween,
  MIN_EXPENSE_MONTHS_FOR_CAP_RATE,
} from "@/lib/investment-package";
import { buildRentRoll, type RentRollPropertyRef, type RentRollTenancyInput } from "@/lib/rent-roll";
import { buildIncomeStatement } from "@/lib/income-statement";
import { expenseToCostRow } from "@/lib/expenses";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import type { DateRange, PropertyRef, RentRow } from "@/lib/statements";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}
const warned = (pkg: { basis: { warnings: { code: string }[] } }, code: string) =>
  pkg.basis.warnings.some((w) => w.code === code);

const BK = "506 manning avenue, toronto, on m6g 2v7";
const U1 = "11111111-0000-0000-0000-000000000001";
const U2 = "22222222-0000-0000-0000-000000000002";
const U3 = "33333333-0000-0000-0000-000000000003";
const ASOF = "2026-09-11";
// A period that has fully elapsed, so the window is not clamped and the
// arithmetic assertions below are about the sums, not about the scaling.
const ASOF_DONE = "2026-12-31";

const rentRollProps: RentRollPropertyRef[] = [
  { id: U1, address: "506 Manning Avenue, Unit 1 (Main), Toronto, ON", buildingKey: BK },
  { id: U2, address: "506 Manning Avenue, Unit 2 (Upper), Toronto, ON", buildingKey: BK },
  { id: U3, address: "506 Manning Avenue, Unit 3 (Lower), Toronto, ON", buildingKey: BK, askingRentCents: 175000 },
];
const statementProps: PropertyRef[] = rentRollProps.map((p) => ({
  id: p.id,
  address: p.address,
  buildingKey: p.buildingKey,
}));

// U1 fixed to 2027-03-31, U2 month to month (no end date), U3 vacant.
const tenancies: RentRollTenancyInput[] = [
  { propertyId: U1, status: "active", rentCents: 262000, startDate: "2025-04-01", endDate: "2027-03-31", primaryTenantName: "A. Tenant", coTenantCount: 1 },
  { propertyId: U2, status: "active", rentCents: 335200, startDate: "2023-06-01", endDate: null, primaryTenantName: "B. Tenant", coTenantCount: 0 },
];

const roll = buildRentRoll(rentRollProps, tenancies);
const building = roll.buildings.find((b) => b.buildingKey === BK)!;

function statementFor(costRows: WorkOrderCostRow[], rentRows: RentRow[], range: DateRange) {
  return buildIncomeStatement(rentRows, costRows, statementProps, range);
}

const YEAR: DateRange = { from: "2026-01-01", to: "2026-12-31" };

// --- A. The rent roll half --------------------------------------------------
{
  const pkg = buildInvestmentPackage({
    building,
    statement: statementFor([], [], YEAR),
    range: YEAR,
    asOf: ASOF,
  });
  ok("units: all three present", pkg.units.length === 3);
  ok("units: unit label pulled off the address", pkg.units[0].unitLabel === "Unit 1");
  ok("occupancy: 2 of 3", pkg.headline.occupiedCount === 2 && pkg.headline.unitCount === 3);
  ok("occupancy: percent rounded", pkg.headline.occupancyPct === 67);
  ok("in place monthly excludes the vacant unit", pkg.headline.inPlaceMonthlyRentCents === 262000 + 335200);
  ok("in place annual is twelve months of that", pkg.headline.inPlaceAnnualRentCents === (262000 + 335200) * 12);

  const u1 = pkg.units.find((u) => u.propertyId === U1)!;
  const u2 = pkg.units.find((u) => u.propertyId === U2)!;
  const u3 = pkg.units.find((u) => u.propertyId === U3)!;
  ok("lease kind: fixed term", u1.leaseKind === "fixed");
  ok("lease kind: no end date is month to month", u2.leaseKind === "month_to_month");
  ok("lease kind: vacant", u3.leaseKind === "vacant");
  ok("months to expiry counted in calendar months", u1.monthsToExpiry === 6);
  ok("month to month has no expiry number", u2.monthsToExpiry === null);
  ok("tenant label carries co-tenants", u1.tenantLabel === "A. Tenant +1 co-tenant");
}

// --- B. Expiry schedule -----------------------------------------------------
{
  const pkg = buildInvestmentPackage({
    building,
    statement: statementFor([], [], YEAR),
    range: YEAR,
    asOf: ASOF,
  });
  ok("expiry: month to month counted separately", pkg.expiry.monthToMonthUnits === 1);
  ok("expiry: month to month rent", pkg.expiry.monthToMonthMonthlyRentCents === 335200);
  ok("expiry: one unit rolls inside the horizon", pkg.expiry.expiringWithinHorizonUnits === 1);
  ok("expiry: bucketed by month", pkg.expiry.byMonth.length === 1 && pkg.expiry.byMonth[0].month === "2027-03");
  ok("expiry: a vacant unit is in neither bucket", pkg.expiry.monthToMonthUnits + pkg.expiry.expiringWithinHorizonUnits === 2);

  // A lease ending beyond the horizon must NOT appear.
  const far = buildRentRoll(rentRollProps, [
    { propertyId: U1, status: "active", rentCents: 262000, startDate: "2025-04-01", endDate: "2029-01-31", primaryTenantName: "A", coTenantCount: 0 },
  ]);
  const farPkg = buildInvestmentPackage({
    building: far.buildings.find((b) => b.buildingKey === BK)!,
    statement: statementFor([], [], YEAR),
    range: YEAR,
    asOf: ASOF,
  });
  ok("expiry: a lease past the horizon is excluded", farPkg.expiry.expiringWithinHorizonUnits === 0 && farPkg.expiry.byMonth.length === 0);
}

// --- C. Rent gap ------------------------------------------------------------
{
  const pkg = buildInvestmentPackage({
    building,
    statement: statementFor([], [], YEAR),
    range: YEAR,
    asOf: ASOF,
    marketRentByPropertyId: { [U1]: 300000, [U3]: 175000 },
  });
  ok("gap: only occupied units priced", pkg.rentGap.unitsPriced === 1);
  ok("gap: the occupied unit without a market rent is counted unpriced", pkg.rentGap.unitsUnpriced === 1);
  ok("gap: a VACANT unit's market rent is never counted as upside", pkg.rentGap.marketMonthlyCents === 300000);
  ok("gap: monthly", pkg.rentGap.monthlyGapCents === 300000 - 262000);
  ok("gap: annual is twelve times monthly", pkg.rentGap.annualGapCents === (300000 - 262000) * 12);
  ok("gap: partial pricing warns", warned(pkg, "market_rent_partial"));
}

// --- D. THE REFUSALS. What the package will not publish ---------------------
{
  const oneMonth: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: BK, category: "property_tax", amount_cents: 93819, incurred_on: "2026-06-15" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 69550, incurred_on: "2026-06-22" }),
  ];
  const thin = buildInvestmentPackage({
    building,
    statement: statementFor(oneMonth, [], YEAR),
    costRows: oneMonth,
    range: YEAR,
    asOf: ASOF_DONE,
    askingPriceCents: 200000000,
    windowDays: 365,
  });
  ok("refusal: one month of costs withholds the cap rate", thin.headline.capRatePct === null);
  ok("refusal: and says why", warned(thin, "thin_expense_history"));
  ok("refusal: NOI is still computed and shown", thin.headline.noiCents === building.inPlaceAnnualRentCents - (93819 + 69550));

  const none = buildInvestmentPackage({
    building,
    statement: statementFor([], [], YEAR),
    range: YEAR,
    asOf: ASOF,
    askingPriceCents: 200000000,
    windowDays: 365,
  });
  ok("refusal: no costs at all withholds the cap rate", none.headline.capRatePct === null);
  ok("refusal: no costs warns that NOI is not a result", warned(none, "no_expenses"));

  // The guard must be able to PASS, or it proves nothing.
  const full: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: BK, category: "property_tax", amount_cents: 300000, incurred_on: "2026-03-15" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 200000, incurred_on: "2026-06-22" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "insurance", amount_cents: 100000, incurred_on: "2026-09-01" }),
  ];
  const sound = buildInvestmentPackage({
    building,
    statement: statementFor(full, [], YEAR),
    costRows: full,
    range: YEAR,
    asOf: ASOF_DONE,
    askingPriceCents: 200000000,
    windowDays: 365,
  });
  ok("guard can pass: three months and a price gives a cap rate", sound.headline.capRatePct !== null);
  ok("guard can pass: no thin-history warning", !warned(sound, "thin_expense_history"));
  ok(
    "cap rate math: NOI over price",
    sound.headline.capRatePct === Math.round(((building.inPlaceAnnualRentCents - 600000) / 200000000) * 100 * 100) / 100,
  );
  ok("threshold is the documented constant", MIN_EXPENSE_MONTHS_FOR_CAP_RATE === 3);

  // An unbounded period cannot be annualized, so the number is withheld even
  // when there is plenty of recorded cost.
  const allTime = buildInvestmentPackage({
    building,
    statement: statementFor(full, [], { from: null, to: null }),
    costRows: full,
    range: { from: null, to: null },
    asOf: ASOF,
    askingPriceCents: 200000000,
    windowDays: null,
  });
  ok("refusal: an unbounded period withholds the cap rate", allTime.headline.capRatePct === null);
  ok("refusal: and says to pick a year", warned(allTime, "unbounded_period"));
  ok("refusal: unbounded is NOT reported as thin history", !warned(allTime, "thin_expense_history"));

  const noPrice = buildInvestmentPackage({
    building,
    statement: statementFor(full, [], YEAR),
    costRows: full,
    range: YEAR,
    asOf: ASOF,
    windowDays: 365,
  });
  ok("refusal: no asking price means no cap rate and no GRM", noPrice.headline.capRatePct === null && noPrice.headline.grossRentMultiplier === null);
  ok("refusal: and says so", warned(noPrice, "no_asking_price"));
}

// --- E. Honesty warnings that are not about the cap rate --------------------
{
  const withMortgage: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: BK, category: "property_tax", amount_cents: 300000, incurred_on: "2026-03-15" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 200000, incurred_on: "2026-06-22" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "insurance", amount_cents: 100000, incurred_on: "2026-09-01" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "mortgage", amount_cents: 420910, incurred_on: "2026-06-22" }),
  ];
  const pkg = buildInvestmentPackage({
    building,
    statement: statementFor(withMortgage, [], YEAR),
    costRows: withMortgage,
    range: YEAR,
    asOf: ASOF_DONE,
    askingPriceCents: 200000000,
    windowDays: 365,
  });
  ok("warns when mortgage is recorded with zero interest", warned(pkg, "no_interest_split"));
  ok("warns when no rent payment was ever recorded", warned(pkg, "rent_not_recorded"));
  ok("mortgage never touches operating expenses", pkg.headline.annualOperatingExpensesCents === 600000);

  const paid: RentRow[] = [{ property_id: U1, amount_cents: 262000, paid_on: "2026-06-05" }];
  const withRent = buildInvestmentPackage({
    building,
    statement: statementFor(withMortgage, paid, YEAR),
    costRows: withMortgage,
    range: YEAR,
    asOf: ASOF,
    askingPriceCents: 200000000,
    windowDays: 365,
    rentPaymentsObserved: 1,
  });
  ok("no rent warning once payments exist", !warned(withRent, "rent_not_recorded"));

  const unassigned: WorkOrderCostRow[] = [
    ...withMortgage,
    expenseToCostRow({ property_id: null, building_key: null, category: "professional", amount_cents: 50000, incurred_on: "2026-05-01" }),
  ];
  const excl = buildInvestmentPackage({
    building,
    statement: statementFor(unassigned, [], YEAR),
    costRows: unassigned,
    range: YEAR,
    asOf: ASOF_DONE,
    askingPriceCents: 200000000,
    windowDays: 365,
  });
  ok("unassigned cost is excluded and disclosed", excl.basis.excludedUnassignedCents === 50000 && warned(excl, "unassigned_costs_excluded"));
  ok("unassigned cost does NOT inflate the building's operating expenses", excl.headline.annualOperatingExpensesCents === 600000);
}

// --- E2. The window is clamped to what has actually elapsed -----------------
{
  const ytd: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: BK, category: "property_tax", amount_cents: 400000, incurred_on: "2026-02-15" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 400000, incurred_on: "2026-05-22" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "insurance", amount_cents: 400000, incurred_on: "2026-08-01" }),
  ];
  const common = { building, costRows: ytd, range: YEAR, askingPriceCents: 200000000, windowDays: 365 };
  const midYear = buildInvestmentPackage({ ...common, statement: statementFor(ytd, [], YEAR), asOf: ASOF });
  const yearEnd = buildInvestmentPackage({ ...common, statement: statementFor(ytd, [], YEAR), asOf: ASOF_DONE });

  ok("clamp: year to date is scaled UP, not published as the year", midYear.headline.annualOperatingExpensesCents > 1200000);
  ok("clamp: a finished year is not scaled", yearEnd.headline.annualOperatingExpensesCents === 1200000);
  ok("clamp: scaling is disclosed", warned(midYear, "expenses_annualized"));
  ok("clamp: the finished year says nothing about scaling", !warned(yearEnd, "expenses_annualized"));
  ok("clamp: mid year NOI is lower than the unclamped reading", midYear.headline.noiCents < yearEnd.headline.noiCents);
  ok("clamp: basis reports the elapsed days, not the nominal ones", midYear.basis.windowDays === 254);

  const shortRange: DateRange = { from: "2026-01-31", to: "2026-03-02" };
  const boundary: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 20000, incurred_on: "2026-01-31" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 20000, incurred_on: "2026-02-01" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 25000, incurred_on: "2026-03-02" }),
  ];
  const shortPkg = buildInvestmentPackage({
    building,
    statement: statementFor(boundary, [], shortRange),
    costRows: boundary,
    range: shortRange,
    asOf: ASOF_DONE,
    askingPriceCents: 200000000,
    windowDays: 31,
  });
  ok("short window: three month labels do not buy a cap rate", shortPkg.headline.capRatePct === null);
  ok("short window: says the period is too short", warned(shortPkg, "window_too_short"));
  ok("short window: three distinct months were genuinely seen", shortPkg.basis.expenseMonthsObserved === 3);
}

// --- E3. Only THIS building's costs, and only operating ones ----------------
{
  const OTHER = "99 other st, toronto";
  const mixed: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: BK, category: "property_tax", amount_cents: 300000, incurred_on: "2026-03-15" }),
    expenseToCostRow({ property_id: U2, building_key: null, category: "maintenance", amount_cents: 50000, incurred_on: "2026-05-02" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "insurance", amount_cents: 100000, incurred_on: "2026-08-01" }),
    expenseToCostRow({ property_id: null, building_key: OTHER, category: "property_tax", amount_cents: 999999, incurred_on: "2026-04-01" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "mortgage", amount_cents: 420910, incurred_on: "2026-06-22" }),
  ];
  const pkg2 = buildInvestmentPackage({
    building,
    statement: statementFor(mixed, [], YEAR),
    costRows: mixed,
    range: YEAR,
    asOf: ASOF_DONE,
    askingPriceCents: 200000000,
    windowDays: 365,
  });
  const lineTotal = pkg2.operatingLines.reduce((sum, l) => sum + l.totalCents, 0);
  ok("scoping: another building's cost is absent from the categories", !pkg2.operatingLines.some((l) => l.totalCents === 999999));
  ok("scoping: categories sum to the headline operating figure", lineTotal === pkg2.headline.annualOperatingExpensesCents);
  ok("scoping: the sum is this building's own costs", lineTotal === 300000 + 50000 + 100000);
  ok("scoping: a unit-scoped cost is included", pkg2.operatingLines.some((l) => l.category === "maintenance" && l.totalCents === 50000));
  ok("scoping: financing is not a category line", !pkg2.operatingLines.some((l) => l.category === "mortgage"));
  ok("scoping: item count is operating only", pkg2.basis.expenseItems === 3);
  ok("scoping: another building's number never reaches the csv", !investmentPackageToCsv(pkg2).includes("9999.99"));
}

// --- E4. A lease already past its end date is not "rolling soon" ------------
{
  const holdover = buildRentRoll(rentRollProps, [
    { propertyId: U1, status: "active", rentCents: 262000, startDate: "2023-01-01", endDate: "2025-06-30", primaryTenantName: "Holding Over", coTenantCount: 0 },
    { propertyId: U2, status: "active", rentCents: 335200, startDate: "2026-01-01", endDate: "2026-12-31", primaryTenantName: "Live", coTenantCount: 0 },
  ]);
  const pkg3 = buildInvestmentPackage({
    building: holdover.buildings.find((b) => b.buildingKey === BK)!,
    statement: statementFor([], [], YEAR),
    costRows: [],
    range: YEAR,
    asOf: ASOF,
  });
  ok("holdover: the expired lease is not counted as rolling", pkg3.expiry.expiringWithinHorizonUnits === 1);
  ok("holdover: it gets its own bucket", pkg3.expiry.expiredUnits === 1 && pkg3.expiry.expiredMonthlyRentCents === 262000);
  ok("holdover: no past month appears in the schedule", pkg3.expiry.byMonth.every((b) => b.month >= ASOF.slice(0, 7)));
  ok("holdover: it is disclosed", warned(pkg3, "holding_over"));
  ok("holdover: csv names it", investmentPackageToCsv(pkg3).includes("Already past the end date"));
}

// --- F. Helpers and CSV -----------------------------------------------------
{
  ok("months: forward", wholeMonthsBetween("2026-09-11", "2027-03-31") === 6);
  ok("months: a past date floors at zero", wholeMonthsBetween("2026-09-11", "2025-01-01") === 0);
  ok("months: same month is zero", wholeMonthsBetween("2026-09-01", "2026-09-30") === 0);
  ok("months: a malformed date is zero, never NaN", wholeMonthsBetween("", "2027-03-31") === 0);

  const pkg = buildInvestmentPackage({
    building,
    statement: statementFor([], [], YEAR),
    range: YEAR,
    asOf: ASOF,
    marketRentByPropertyId: { [U1]: 300000 },
  });
  const csv = investmentPackageToCsv(pkg);
  ok("csv: names the building", csv.includes("506 Manning Avenue"));
  ok("csv: a withheld cap rate says withheld, never a number", csv.includes("Cap rate,withheld"));
  ok("csv: month to month is spelled out for the reader", csv.includes("Month to month"));
  ok("csv: carries the not-an-appraisal note", csv.includes("not an appraisal"));
  ok("csv: every warning is printed", pkg.basis.warnings.every((w) => csv.includes(w.message)));
  ok("csv: no em dashes", !csv.includes("—"));
}

console.log(failed === 0 ? `PASS ${passed}/${passed + failed}` : `FAIL ${failed} of ${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
