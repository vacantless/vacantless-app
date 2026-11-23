// S836e: the expense report, after FreshBooks Reports > Expense Report (Noam
// 2026-11-23: "you need to go to reports - expense reports too"). Every cost
// line grouped by category with a subtotal for each, the merchant, the date,
// what it was for and which unit, for a date range, with a unit and category
// filter and a CSV. The lines are exactly the ones the income statement counts
// (expenses by incurred date, repairs with a cost by completed date), so the
// operating total here equals the statement's operating expenses for the same
// range. Mortgage lines are listed last, for reference, as the statement does.
// Pure and tested in scripts/test-s836e-expense-report.ts.
import { isOperatingCategory } from "@/lib/expenses";
import type { DateRange } from "@/lib/statements";

export type ExpenseLine = {
  source: "expense" | "repair";
  category: string;
  categoryLabel: string;
  amountCents: number;
  /** YYYY-MM-DD: incurred (expense) or completed (repair). */
  day: string;
  merchant: string | null;
  /** The note on an expense, or the repair's title. */
  detail: string | null;
  /** Unit label, "Building-wide" or "Not tied to a unit". */
  where: string;
  propertyId: string | null;
};

export type ExpenseGroup = {
  category: string;
  label: string;
  operating: boolean;
  lines: ExpenseLine[];
  subtotalCents: number;
};

export type ExpenseReport = {
  groups: ExpenseGroup[];
  operatingCents: number;
  financingCents: number;
  count: number;
};

export function inRange(day: string | null, range: DateRange): boolean {
  if (!day) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

/** Group, filter and total. Biggest operating group first; mortgage lines last. Pure. */
export function buildExpenseReport(
  lines: readonly ExpenseLine[],
  range: DateRange,
  filter: { propertyId?: string | null; category?: string | null } = {},
): ExpenseReport {
  const kept = lines.filter(
    (l) =>
      inRange(l.day, range) &&
      (!filter.propertyId || l.propertyId === filter.propertyId) &&
      (!filter.category || l.category === filter.category),
  );
  const map = new Map<string, ExpenseGroup>();
  for (const l of kept) {
    let g = map.get(l.category);
    if (!g) {
      g = { category: l.category, label: l.categoryLabel, operating: isOperatingCategory(l.category), lines: [], subtotalCents: 0 };
      map.set(l.category, g);
    }
    g.lines.push(l);
    g.subtotalCents += l.amountCents;
  }
  const groups = [...map.values()];
  for (const g of groups) g.lines.sort((a, b) => b.day.localeCompare(a.day) || b.amountCents - a.amountCents);
  groups.sort((a, b) => Number(b.operating) - Number(a.operating) || b.subtotalCents - a.subtotalCents || a.label.localeCompare(b.label));
  return {
    groups,
    operatingCents: groups.filter((g) => g.operating).reduce((s, g) => s + g.subtotalCents, 0),
    financingCents: groups.filter((g) => !g.operating).reduce((s, g) => s + g.subtotalCents, 0),
    count: kept.length,
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One row per line, grouped like the page, with a subtotal row per category. Pure. */
export function expenseReportToCsv(report: ExpenseReport): string {
  const rows: string[] = ["Category,Date,Merchant,Details,Unit,Type,Amount"];
  const money = (c: number) => (c / 100).toFixed(2);
  for (const g of report.groups) {
    for (const l of g.lines) {
      rows.push(
        [g.label, l.day, l.merchant ?? "", l.detail ?? "", l.where, l.source === "repair" ? "Repair" : "Expense", money(l.amountCents)].map(csvCell).join(","),
      );
    }
    rows.push([`Total for ${g.label}`, "", "", "", "", "", money(g.subtotalCents)].map(csvCell).join(","));
  }
  rows.push(["Total operating expenses", "", "", "", "", "", money(report.operatingCents)].map(csvCell).join(","));
  if (report.financingCents) rows.push(["Mortgage, for reference", "", "", "", "", "", money(report.financingCents)].map(csvCell).join(","));
  return rows.join("\n") + "\n";
}
