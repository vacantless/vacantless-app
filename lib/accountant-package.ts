// Pure accountant hand-off package model (no I/O). The S525 P&L, S526 T776,
// owner statement, and rent roll are SUMMARIES; what an accountant re-keys from
// (or imports into Xero/QuickBooks) is the TRANSACTION LIST underneath them.
// This module turns the same raw rows those reports already consume into a
// general ledger — one dated line per rent payment / expense / work-order cost —
// plus bank-style CSVs in the shapes QuickBooks Online and Xero import, and the
// README that explains the package. All summary math stays in the existing
// builders; this file must RECONCILE to them, never recompute differently:
// entries are included by exactly the same rules (rent by paid_on; costs by
// completed_on/incurred_on; undated or costless rows excluded — mirroring
// lib/t776 costInRange and lib/statements rentInRange).
//
// No rows are inserted, updated, or deleted anywhere in this module.

import type { DateRange, RentRow } from "./statements";
import { describeRange } from "./statements";
import { expenseCategoryLabel, isExpenseCategory } from "./expenses";
import type { WorkOrderCostRow } from "./work-orders";
import { workOrderCategoryLabel } from "./work-orders";
import { t776LineForCategory } from "./t776";

export type LedgerSource = "rent" | "expense" | "work_order";

export type LedgerEntry = {
  /** ISO date the money moved (paid_on / incurred_on / completed_on). */
  date: string;
  source: LedgerSource;
  /** Raw category key ("plumbing", "insurance", …); null for rent income. */
  category: string | null;
  /** Human category label ("Plumbing", "Insurance"); "Rent" for income. */
  categoryLabel: string;
  /** T776 line the category maps to ("8960"); "8299" for rent; null if unmapped. */
  t776Line: string | null;
  /** Human description: merchant/title/note where present, else the label. */
  description: string;
  /** Property address, or "Building: <key>" for building-scoped, or "Unassigned". */
  property: string;
  /** SIGNED cents: income positive, costs negative. */
  amountCents: number;
};

export type LedgerExpenseRow = {
  property_id: string | null;
  building_key?: string | null;
  category: string;
  amount_cents: number;
  incurred_on: string;
  merchant?: string | null;
  note?: string | null;
};

export type LedgerWorkOrderRow = WorkOrderCostRow & { title?: string | null };

export type PropertyLookup = { id: string; address: string };

const UNASSIGNED = "Unassigned";

function inRange(date: string | null, range: DateRange): boolean {
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function propertyLabel(
  propertyId: string | null | undefined,
  buildingKey: string | null | undefined,
  addressOf: Map<string, string>,
): string {
  if (propertyId) return addressOf.get(propertyId) ?? UNASSIGNED;
  if (buildingKey) return `Building: ${buildingKey}`;
  return UNASSIGNED;
}

function categoryBits(category: string): { label: string; line: string | null } {
  const label = isExpenseCategory(category)
    ? expenseCategoryLabel(category)
    : workOrderCategoryLabel(category);
  return { label, line: t776LineForCategory(category) };
}

/**
 * Build the general ledger for a window: every rent payment (income, positive)
 * and every dated, costed expense / work-order line (cost, negative), sorted by
 * date then income-before-cost then description, so the CSV reads like a bank
 * statement. Inclusion mirrors the report builders exactly — the GL total must
 * equal the income statement's netCash for the same window.
 */
export function buildGeneralLedger(
  rentRows: RentRow[],
  expenseRows: LedgerExpenseRow[],
  workOrderRows: LedgerWorkOrderRow[],
  properties: PropertyLookup[],
  range: DateRange,
): LedgerEntry[] {
  const addressOf = new Map(properties.map((p) => [p.id, p.address]));
  const entries: LedgerEntry[] = [];

  for (const r of rentRows) {
    if (!inRange(r.paid_on, range)) continue;
    entries.push({
      date: r.paid_on as string,
      source: "rent",
      category: null,
      categoryLabel: "Rent",
      t776Line: "8299",
      description: "Rent received",
      property: propertyLabel(r.property_id, null, addressOf),
      amountCents: r.amount_cents,
    });
  }

  for (const e of expenseRows) {
    if (!inRange(e.incurred_on, range)) continue;
    const { label, line } = categoryBits(e.category);
    const merchant = (e.merchant ?? "").trim();
    const note = (e.note ?? "").trim();
    const description =
      merchant && note ? `${merchant} — ${note}` : merchant || note || label;
    entries.push({
      date: e.incurred_on,
      source: "expense",
      category: e.category,
      categoryLabel: label,
      t776Line: line,
      description,
      property: propertyLabel(e.property_id, e.building_key, addressOf),
      amountCents: -e.amount_cents,
    });
  }

  for (const w of workOrderRows) {
    if (w.cost_cents == null) continue; // costless work orders never count
    if (!inRange(w.completed_on, range)) continue; // undated = not completed yet
    const { label, line } = categoryBits(w.category);
    const title = (w.title ?? "").trim();
    entries.push({
      date: w.completed_on as string,
      source: "work_order",
      category: w.category,
      categoryLabel: label,
      t776Line: line,
      description: title || label,
      property: propertyLabel(w.property_id, w.building_key, addressOf),
      amountCents: -w.cost_cents,
    });
  }

  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.amountCents >= 0 === b.amountCents >= 0 ? 0 : a.amountCents >= 0 ? -1 : 1) ||
      a.description.localeCompare(b.description),
  );
  return entries;
}

/** Signed GL total — reconciles to the income statement's netCash. */
export function ledgerTotalCents(entries: LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amountCents, 0);
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain dollars with two decimals, no symbol/grouping — clean for imports. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

const SOURCE_LABELS: Record<LedgerSource, string> = {
  rent: "Rent income",
  expense: "Expense",
  work_order: "Work order",
};

/**
 * The full general-ledger CSV: header block (period), then one row per entry
 * with the T776 line beside the category so an accountant can verify the
 * summary package line-by-line, then a signed TOTAL row.
 */
export function generalLedgerToCsv(entries: LedgerEntry[], range: DateRange): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));

  row(["General ledger"]);
  row(["Period", describeRange(range)]);
  lines.push("");
  row(["Date", "Type", "Description", "Property", "Category", "T776 line", "Amount"]);
  for (const e of entries) {
    row([
      e.date,
      SOURCE_LABELS[e.source],
      e.description,
      e.property,
      e.categoryLabel,
      e.t776Line ?? "",
      dollars(e.amountCents),
    ]);
  }
  lines.push("");
  row(["TOTAL", "", "", "", "", "", dollars(ledgerTotalCents(entries))]);
  return lines.join("\n") + "\n";
}

/**
 * QuickBooks Online 3-column bank CSV (Date, Description, Amount — deposits
 * positive, payments negative), importable via Banking → Upload transactions.
 * Property and category ride inside the description because the 3-column
 * format has nowhere else to carry them.
 */
export function ledgerToQuickBooksCsv(entries: LedgerEntry[]): string {
  const lines: string[] = ["Date,Description,Amount"];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));
  for (const e of entries) {
    row([e.date, `${e.description} (${e.property} · ${e.categoryLabel})`, dollars(e.amountCents)]);
  }
  return lines.join("\n") + "\n";
}

/**
 * Xero bank-statement CSV (Date, Amount, Payee, Description, Reference),
 * importable via a bank account → Import a statement. Reference carries the
 * T776 line for the accountant's mapping pass.
 */
export function ledgerToXeroCsv(entries: LedgerEntry[]): string {
  const lines: string[] = ["Date,Amount,Payee,Description,Reference"];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));
  for (const e of entries) {
    row([
      e.date,
      dollars(e.amountCents),
      e.property,
      `${e.description} (${e.categoryLabel})`,
      e.t776Line ? `T776 ${e.t776Line}` : "",
    ]);
  }
  return lines.join("\n") + "\n";
}

/** Canonical file names inside the package ZIP, in README order. */
export const PACKAGE_FILES = [
  "README.txt",
  "general-ledger.csv",
  "t776-tax-package.csv",
  "income-statement.csv",
  "owner-statement.csv",
  "rent-roll.csv",
  "quickbooks-transactions.csv",
  "xero-transactions.csv",
] as const;

/**
 * The plain-text README that fronts the package: what each file is, the basis
 * rules an accountant needs (cash-basis rent, actual-basis costs, mortgage
 * principal as memo only, CCA left blank on purpose), and the standing
 * disclaimer that this summarizes the operator's records — it is not a filed
 * return and Vacantless never moves money.
 */
export function accountantPackageReadme(input: {
  orgName: string;
  range: DateRange;
  generatedOn: string; // ISO date
  entryCount: number;
}): string {
  const period = describeRange(input.range);
  return [
    `Accountant package — ${input.orgName}`,
    `Period: ${period}`,
    `Generated: ${input.generatedOn} by Vacantless`,
    ``,
    `What's inside`,
    `-------------`,
    `general-ledger.csv          Every transaction in the period (${input.entryCount} entries):`,
    `                            rent received, expenses, and completed work-order`,
    `                            costs, each with its category and T776 line.`,
    `t776-tax-package.csv        Year-end summary mapped to T776 rental tax lines,`,
    `                            per property and for the portfolio.`,
    `income-statement.csv        Actual-basis P&L: revenue, operating expenses,`,
    `                            NOI, interest, net income.`,
    `owner-statement.csv         Cash summary per property with monthly detail.`,
    `rent-roll.csv               Current tenancies, rents, and occupancy.`,
    `quickbooks-transactions.csv The ledger in QuickBooks Online's 3-column bank`,
    `                            format (Banking -> Upload transactions).`,
    `xero-transactions.csv       The ledger in Xero's bank-statement format`,
    `                            (bank account -> Import a statement).`,
    ``,
    `How the numbers are kept`,
    `------------------------`,
    `- Rent income is CASH basis: counted on the date it was received (paid_on).`,
    `- Expenses and work-order costs are ACTUAL basis: counted on the date`,
    `  incurred / completed. Work orders with no recorded cost are excluded.`,
    `- Mortgage PRINCIPAL is capital repayment, not an expense: it appears as a`,
    `  memo line only and never reduces net income. Mortgage INTEREST does.`,
    `- T776 line 9936 (capital cost allowance) is intentionally blank - CCA is a`,
    `  claim decision to make with your accountant.`,
    `- Amounts are plain dollars with two decimals; income positive, costs`,
    `  negative. The general-ledger TOTAL reconciles to the income statement's`,
    `  net cash for the same period.`,
    ``,
    `This package summarizes the operator's records in Vacantless. It is not a`,
    `filed return, and Vacantless never moves money.`,
    ``,
  ].join("\n");
}
