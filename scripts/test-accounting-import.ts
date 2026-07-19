// Unit tests for the pure accounting-history import spine. Run:
// npx tsx scripts/test-accounting-import.ts
import {
  buildCategorizationImportPlan,
  mapSourceCategory,
  matchLedgerRows,
  parseFreshbooksCsv,
  type LedgerRow,
  type MatchableBankTxn,
} from "../lib/accounting-import";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function row(partial: Partial<LedgerRow>): LedgerRow {
  return {
    rowNo: 1,
    date: "2026-07-01",
    amountCents: 10000,
    direction: "debit",
    description: "Hydro One",
    sourceCategory: "Utilities",
    clientTag: "12 Donwoods Unit 1",
    ...partial,
  };
}

function txn(id: string, partial: Partial<MatchableBankTxn> = {}): MatchableBankTxn {
  return {
    id,
    amountCents: 10000,
    postedOn: "2026-07-01",
    direction: "debit",
    merchant: "Hydro One",
    description: "Hydro One bill",
    triageStatus: "pending",
    ...partial,
  };
}

// --- FreshBooks CSV parser ---------------------------------------------------
{
  const csv = [
    "Transaction Date,Grand Total,Vendor,Expense Category,Project",
    '07/01/2026,"$1,234.56","City of Toronto","Property Taxes","12 Donwoods Unit 1"',
    '2026-07-02,"($50.25)","Hydro, East","Utilities","12 Donwoods Unit 1"',
    '2026-07-03,"$2,400.00 CR","Tenant","Rental Income","12 Donwoods Unit 1"',
    '"2026-07-04","$40.00","Rogers, ""Cable""\nMemo","Repairs","12 Donwoods Unit 1"',
    ",,,,",
    "Total,,,,",
  ].join("\n");
  const parsed = parseFreshbooksCsv(csv);
  ok("parser accepts alias headers", parsed.ok && parsed.columns.includes("Grand Total"));
  ok("parser parses currency with grouping", parsed.ok && parsed.rows[0].amountCents === 123456);
  ok("parser treats parentheses as debit amount", parsed.ok && parsed.rows[1].amountCents === 5025 && parsed.rows[1].direction === "debit");
  ok("parser treats trailing CR as credit", parsed.ok && parsed.rows[2].direction === "credit");
  ok("parser preserves quoted embedded comma/newline", parsed.ok && /Rogers, "Cable"\nMemo/.test(parsed.rows[3].description ?? ""));
  ok("parser skips blank and total rows", parsed.ok && parsed.skipped === 2);
}
{
  const parsed = parseFreshbooksCsv("Date,Debit,Credit,Account\n2026-07-01,,$99.50,Rental Income");
  ok("parser supports debit/credit amount columns", parsed.ok && parsed.rows[0].amountCents === 9950 && parsed.rows[0].direction === "credit");
}
{
  const parsed = parseFreshbooksCsv("Date,Amount,Description\n2026-07-01,$10,Hydro");
  ok("parser reports missing required columns", !parsed.ok && parsed.reason === "missing_columns");
}
{
  const parsed = parseFreshbooksCsv('Date,Amount,Category\n"2026-07-01,$10,Utilities');
  ok("parser reports malformed quoted CSV", !parsed.ok && parsed.reason === "not_csv");
}

// --- Matcher ----------------------------------------------------------------
{
  const matches = matchLedgerRows(
    [row({ rowNo: 10, amountCents: 12500, date: "2026-07-05", description: "Enbridge Gas" })],
    [txn("t1", { amountCents: 12500, postedOn: "2026-07-07", merchant: "Enbridge Gas" })],
  );
  ok("matcher matches exact amount/direction within date window", matches[0].kind === "matched" && matches[0].transactionId === "t1");
}
{
  const matches = matchLedgerRows(
    [row({ rowNo: 11, amountCents: 12500, date: "2026-07-05", description: null })],
    [
      txn("t1", { amountCents: 12500, postedOn: "2026-07-05", merchant: null, description: null }),
      txn("t2", { amountCents: 12500, postedOn: "2026-07-05", merchant: null, description: null }),
    ],
  );
  ok("matcher marks tied candidates ambiguous", matches[0].kind === "ambiguous" && matches[0].candidateIds.length === 2);
}
{
  const matches = matchLedgerRows(
    [row({ rowNo: 12, amountCents: 12500, date: "2026-07-05" })],
    [txn("t1", { amountCents: 13000, postedOn: "2026-07-05" })],
  );
  ok("matcher reports unmatched outside exact amount", matches[0].kind === "unmatched");
}
{
  const matches = matchLedgerRows(
    [
      row({ rowNo: 13, amountCents: 12500, date: "2026-07-05", description: "Hydro" }),
      row({ rowNo: 14, amountCents: 12500, date: "2026-07-05", description: "Hydro" }),
    ],
    [txn("t1", { amountCents: 12500, postedOn: "2026-07-05", merchant: "Hydro" })],
  );
  ok("matcher claims one bank txn at most once", matches.filter((m) => m.kind === "matched").length === 1);
  ok("matcher leaves duplicate ledger row unmatched after claim", matches.some((m) => m.rowNo === 14 && m.kind === "unmatched"));
}
{
  const matches = matchLedgerRows(
    [row({ rowNo: 15, amountCents: 12500, date: "2026-07-05" })],
    [txn("t1", { amountCents: 12500, postedOn: "2026-07-05", triageStatus: "assigned" })],
  );
  ok("matcher flags already reconciled matches", matches[0].kind === "matched" && matches[0].alreadyReconciled === true);
}

// --- Category map ------------------------------------------------------------
const categoryCases: Array<[string, string]> = [
  ["Property taxes", "property_tax"],
  ["Maintenance and repairs", "maintenance"],
  ["Mortgage", "mortgage"],
  ["Insurance", "insurance"],
  ["Hydro utilities", "utilities"],
  ["Condo fees", "condo_fees"],
  ["Bank service charge", "interest"],
  ["Advertising and marketing", "advertising"],
  ["Legal and accounting", "professional"],
  ["Management fees", "management"],
  ["Office supplies", "supplies"],
];
for (const [input, expected] of categoryCases) {
  const mapped = mapSourceCategory(input, "debit");
  ok(`category maps ${input}`, mapped.kind === "expense" && mapped.category === expected);
}
for (const input of ["Canada essentials", "Transfer", "PayPal", "Refund", "Owner draw"]) {
  ok(`personal category excludes ${input}`, mapSourceCategory(input, "credit").kind === "excluded");
}
ok("credit rent maps to rent", mapSourceCategory("Rental Income", "credit").kind === "rent");
ok("unknown category needs review", mapSourceCategory("Mystery bucket", "debit").kind === "unknown");

// --- Plan builder ------------------------------------------------------------
const properties = [
  { id: "p1", address: "12 Donwoods Drive Unit 1", buildingKey: "12-donwoods-drive" },
  { id: "p2", address: "14 Donwoods Drive Unit 2", buildingKey: "14-donwoods-drive" },
];
{
  const plan = buildCategorizationImportPlan(
    [
      row({ rowNo: 20, amountCents: 8000, date: "2026-07-01", description: "Rogers", sourceCategory: "Utilities" }),
      row({ rowNo: 21, amountCents: 8100, date: "2026-08-01", description: "Rogers", sourceCategory: "Utilities" }),
    ],
    [
      txn("t20", { amountCents: 8000, postedOn: "2026-07-01", merchant: "Rogers" }),
      txn("t21", { amountCents: 8100, postedOn: "2026-08-01", merchant: "Rogers" }),
    ],
    properties,
  );
  ok("plan builder prefers rule_seed for recurring payee group", plan.every((r) => r.plannedAction === "rule_seed"));
}
{
  const plan = buildCategorizationImportPlan(
    [row({ rowNo: 22, amountCents: 9900, description: "Hydro", sourceCategory: "Utilities" })],
    [txn("t22", { amountCents: 9900, merchant: "Hydro" })],
    properties,
  );
  ok("plan builder uses direct_expense for singleton", plan[0].plannedAction === "direct_expense");
}
{
  const plan = buildCategorizationImportPlan(
    [row({ rowNo: 23, amountCents: 9900, clientTag: "Unknown property", sourceCategory: "Utilities" })],
    [txn("t23", { amountCents: 9900 })],
    properties,
  );
  ok("plan builder downgrades unresolved property", plan[0].plannedAction === "needs_review");
}
{
  const plan = buildCategorizationImportPlan(
    [row({ rowNo: 24, amountCents: 9900, sourceCategory: "Mystery" })],
    [txn("t24", { amountCents: 9900 })],
    properties,
  );
  ok("plan builder downgrades unknown category", plan[0].plannedAction === "needs_review");
}
{
  const plan = buildCategorizationImportPlan(
    [row({ rowNo: 25, amountCents: 5000, sourceCategory: "Personal transfer" })],
    [txn("t25", { amountCents: 5000 })],
    properties,
  );
  ok("plan builder excludes matched personal rows", plan[0].plannedAction === "exclude");
}
{
  const plan = buildCategorizationImportPlan(
    [row({ rowNo: 26, amountCents: 240000, direction: "credit", sourceCategory: "Rental Income" })],
    [txn("t26", { amountCents: 240000, direction: "credit" })],
    properties,
  );
  ok("plan builder maps matched rent credits", plan[0].plannedAction === "rent_link");
}

console.log(`\naccounting-import: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
