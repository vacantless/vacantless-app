// S836e: the expense report. Run: npx tsx scripts/test-s836e-expense-report.ts
import { readFileSync } from "node:fs";
import { buildExpenseReport, expenseReportToCsv, type ExpenseLine } from "../lib/expense-report";
import { readExpenseReportParams, expenseReportQuery } from "../lib/expense-report-params";
import { buildIncomeStatement } from "../lib/income-statement";
import type { WorkOrderCostRow } from "../lib/work-orders";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}

const L = (o: Partial<ExpenseLine>): ExpenseLine => ({
  source: "expense",
  category: "utilities",
  categoryLabel: "Utilities",
  amountCents: 10000,
  day: "2026-11-05",
  merchant: "Toronto Hydro",
  detail: null,
  where: "Building-wide",
  propertyId: null,
  ...o,
});
const lines: ExpenseLine[] = [
  L({}),
  L({ day: "2026-10-05", amountCents: 9000 }),
  L({ category: "property_tax", categoryLabel: "Property Tax", amountCents: 93819, day: "2026-07-02", merchant: "City of Toronto" }),
  L({ source: "repair", category: "plumbing", categoryLabel: "Plumbing", amountCents: 32770, day: "2026-11-10", merchant: null, detail: "Leaky tap", where: "506 Manning Ave, Unit 2", propertyId: "u2" }),
  L({ category: "mortgage", categoryLabel: "Mortgage", amountCents: 420910, day: "2026-11-01", merchant: "Bank" }),
  L({ day: "2025-12-31", amountCents: 5000 }),
];
const year = { from: "2026-01-01", to: "2026-12-31" };
const r = buildExpenseReport(lines, year);
ok("last year left out", r.count === 5, r.count);
ok("operating total", r.operatingCents === 10000 + 9000 + 93819 + 32770, r.operatingCents);
ok("mortgage kept apart", r.financingCents === 420910);
ok("biggest operating group first", r.groups[0].label === "Property Tax", r.groups.map((g) => g.label));
ok("mortgage group last", r.groups[r.groups.length - 1].label === "Mortgage" && !r.groups[r.groups.length - 1].operating);
const util = r.groups.find((g) => g.label === "Utilities")!;
ok("subtotal", util.subtotalCents === 19000);
ok("newest first in a group", util.lines[0].day === "2026-11-05");
ok("unit filter", buildExpenseReport(lines, year, { propertyId: "u2" }).operatingCents === 32770);
ok("category filter", buildExpenseReport(lines, year, { category: "utilities" }).count === 2);
ok("month range", buildExpenseReport(lines, { from: "2026-11-01", to: "2026-11-30" }).operatingCents === 10000 + 32770);

// Same total as the income statement for the same lines and range.
const asCost: WorkOrderCostRow[] = lines.map((l) => ({ property_id: l.propertyId, building_key: l.where === "Building-wide" ? "b1" : null, category: l.category, status: "confirmed", cost_cents: l.amountCents, completed_on: l.day }));
const st = buildIncomeStatement([], asCost, [{ id: "u2", address: "506 Manning Ave, Unit 2" }], year);
ok("matches the income statement", st.totals.operatingExpensesCents === r.operatingCents, { st: st.totals.operatingExpensesCents, r: r.operatingCents });

// CSV.
const csv = expenseReportToCsv(r);
ok("csv header", csv.startsWith("Category,Date,Merchant,Details,Unit,Type,Amount\n"));
ok("csv subtotal row", csv.includes("Total for Utilities,,,,,,190.00"));
ok("csv total row", csv.includes(`Total operating expenses,,,,,,${(r.operatingCents / 100).toFixed(2)}`));
ok("csv repair row", csv.includes("Plumbing,2026-11-10,,Leaky tap,\"506 Manning Ave, Unit 2\",Repair,327.70"));
ok("csv mortgage for reference", csv.includes("Mortgage, for reference") || csv.includes("\"Mortgage, for reference\""));
ok("no em dash", !csv.includes("—"));

// Params: page and CSV read the same filters.
const get = (q: Record<string, string>) => (k: string) => q[k];
const p1 = readExpenseReportParams(get({ preset: "custom", from: "2026-11-01", to: "2026-11-30", unit: "6f1d2a3b-1111-4222-8333-944455556666", category: "utilities" }), "2026-11-23");
ok("custom range", p1.range.from === "2026-11-01" && p1.range.to === "2026-11-30");
ok("unit kept", p1.propertyId === "6f1d2a3b-1111-4222-8333-944455556666");
ok("category kept", p1.category === "utilities");
ok("query round trip", expenseReportQuery(p1) === "preset=custom&from=2026-11-01&to=2026-11-30&unit=6f1d2a3b-1111-4222-8333-944455556666&category=utilities", expenseReportQuery(p1));
const p2 = readExpenseReportParams(get({ preset: "nope", unit: "'; drop", category: "Bad Value!" }), "2026-11-23");
ok("bad values dropped", p2.preset === "this_year" && p2.propertyId === null && p2.category === null);

// Wiring.
const srv = readFileSync("lib/expense-report-server.ts", "utf8");
ok("scoped to the account", (srv.match(/\.eq\("organization_id", orgId\)/g) ?? []).length === 3);
ok("repairs need a cost and a finish date", srv.includes('.not("cost_cents", "is", null)') && srv.includes('.not("completed_on", "is", null)'));
const page = readFileSync("app/dashboard/money/expense-report/page.tsx", "utf8");
ok("page is books-only", page.includes("canUseBooks(org)"));
const route = readFileSync("app/dashboard/money/expense-report/export/route.ts", "utf8");
ok("csv checks books and permission", route.includes("canUseBooks(org)") && route.includes('currentUserCan("view_reports")'));
ok("Money lists it", readFileSync("app/dashboard/money/page.tsx", "utf8").includes('href: "/dashboard/money/expense-report"'));
ok("summary links it", readFileSync("lib/account-report-server.ts", "utf8").includes("/dashboard/money/expense-report?preset=custom"));

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
