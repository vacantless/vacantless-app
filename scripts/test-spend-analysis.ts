// Unit tests for the pure spend-analysis read model.
// Run: npx tsx scripts/test-spend-analysis.ts
import { readFileSync } from "fs";
import {
  recurringSpend,
  spendByCategory,
  spendTrend,
  spendWindowRange,
  type SpendExpenseRow,
} from "../lib/spend-analysis";
import { expenseToCostRow } from "../lib/expenses";
import { buildIncomeStatement } from "../lib/income-statement";
import type { CategorizationRule } from "../lib/categorization-rules";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

function file(path: string): string {
  return readFileSync(path, "utf8");
}

const now = new Date("2026-08-15T12:00:00.000Z");

const expenses: SpendExpenseRow[] = [
  {
    id: "aug-utilities",
    category: "utilities",
    amount_cents: 10000,
    incurred_on: "2026-08-05",
    merchant: "Hydro One",
  },
  {
    id: "aug-insurance",
    category: "insurance",
    amount_cents: 20000,
    incurred_on: "2026-08-06",
    merchant: "Intact",
  },
  {
    id: "jul-utilities",
    category: "utilities",
    amount_cents: 15000,
    incurred_on: "2026-07-10",
    merchant: "Enbridge",
  },
  {
    id: "mar-other",
    category: "other",
    amount_cents: 5000,
    incurred_on: "2026-03-01",
    merchant: "Landlord Supplies",
  },
  {
    id: "last-year-mortgage",
    category: "mortgage",
    amount_cents: 100000,
    incurred_on: "2025-08-20",
    merchant: "Lender",
  },
];

const byCategory = spendByCategory(expenses, "last_3", now);
ok("last-3 total includes July and August rows", byCategory.totalCents === 45000);
ok("last-3 count", byCategory.count === 3);
ok("utilities is top category", byCategory.rows[0].category === "utilities");
ok("utilities total", byCategory.rows[0].totalCents === 25000);
ok("insurance share one decimal", byCategory.rows.find((r) => r.category === "insurance")?.sharePct === 44.4);
ok("old mortgage excluded from last-3", !byCategory.rows.some((r) => r.category === "mortgage"));

const thisMonth = spendByCategory(expenses, "this_month", now);
ok("this-month total", thisMonth.totalCents === 30000);
ok("this-month from first day", thisMonth.range.from === "2026-08-01");
ok("this-month to today", thisMonth.range.to === "2026-08-15");

const trend = spendTrend(expenses, "last_3", "month", now);
ok("trend includes current month bucket", trend.rows.some((r) => r.month === "2026-08"));
ok("trend August total", trend.rows.find((r) => r.month === "2026-08")?.totalCents === 30000);
ok("trend July total", trend.rows.find((r) => r.month === "2026-07")?.totalCents === 15000);
ok("trend total equals category total", trend.totalCents === byCategory.totalCents);
ok("trend fills zero months", trend.rows.some((r) => r.totalCents === 0));

const recurringRows: SpendExpenseRow[] = [
  {
    category: "utilities",
    amount_cents: 8999,
    incurred_on: "2026-05-01",
    merchant: "Rogers",
    stream_id: "stream-rogers",
    property_id: "prop-1",
  },
  {
    category: "utilities",
    amount_cents: 8999,
    incurred_on: "2026-06-01",
    merchant: "Rogers",
    stream_id: "stream-rogers",
    property_id: "prop-1",
  },
  {
    category: "utilities",
    amount_cents: 9499,
    incurred_on: "2026-07-01",
    merchant: "Rogers",
    stream_id: "stream-rogers",
    property_id: "prop-1",
  },
];
const rules: CategorizationRule[] = [
  {
    scopeKind: "stream",
    merchantEntityId: null,
    streamId: "stream-cleaning",
    merchantNorm: "maria cleaning",
    accountExternalId: null,
    amountMinCents: 12000,
    amountMaxCents: 12000,
    dayMin: null,
    dayMax: null,
    category: "maintenance",
    propertyId: null,
    buildingKey: "100-king",
  },
];
const recurring = recurringSpend(recurringRows, rules);
const rogers = recurring.find((r) => r.streamId === "stream-rogers");
const cleaning = recurring.find((r) => r.streamId === "stream-cleaning");
ok("recurring groups by stream_id", rogers?.count === 3);
ok("recurring carries last amount", rogers?.lastAmountCents === 9499);
ok("recurring estimates monthly cadence", rogers?.cadenceLabel === "Monthly");
ok("recurring carries property scope", rogers?.propertyId === "prop-1");
ok("rule-only stream is surfaced", cleaning?.source === "rule");
ok("rule-only stream carries amount", cleaning?.lastAmountCents === 12000);
ok("rule-only stream carries building scope", cleaning?.buildingKey === "100-king");

const emptyCategory = spendByCategory([], "last_3", now);
const emptyTrend = spendTrend([], "last_3", "month", now);
ok("empty category total is zero", emptyCategory.totalCents === 0);
ok("empty category rows are empty", emptyCategory.rows.length === 0);
ok("empty trend total is zero", emptyTrend.totalCents === 0);
ok("empty trend still has window buckets", emptyTrend.rows.length > 0);
ok("empty recurring rows are empty", recurringSpend([]).length === 0);

const last12 = spendByCategory(expenses, "last_12", now);
const range = spendWindowRange("last_12", now);
const statement = buildIncomeStatement(
  [],
  expenses.map((e) =>
    expenseToCostRow({
      property_id: e.property_id ?? null,
      building_key: e.building_key ?? null,
      category: e.category,
      amount_cents: e.amount_cents,
      incurred_on: e.incurred_on,
    }),
  ),
  [],
  { from: range.from, to: range.to },
);
const statementSpendTotal =
  statement.totals.operatingExpensesCents +
  statement.totals.interestCents +
  statement.totals.principalCents;
ok("spend total reconciles to income-statement expense lines", last12.totalCents === statementSpendTotal);

const spendPage = file("app/dashboard/money/spend/page.tsx");
const moneyHub = file("app/dashboard/money/page.tsx");
ok("spend route checks accounting entitlement", spendPage.includes('hasEntitlement(org.plan, "accounting")'));
ok("spend loader rejects locked org", spendPage.includes('return { ok: false, reason: "locked" }'));
ok("spend route renders locked upsell", spendPage.includes("Spend analysis is a Premium feature"));
ok("money hub links spend card", moneyHub.includes("/dashboard/money/spend"));

if (failed > 0) {
  console.error(`spend-analysis: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`spend-analysis: ${passed} passed, 0 failed`);
