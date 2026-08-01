// Pure spend-analysis helpers for the Money hub (S610).
// Run: npx tsx scripts/test-spend-analysis.ts
//
// This is a read model over the existing expenses ledger. It does not create a
// parallel accounting figure: category totals sum the same expense rows that
// expenseToCostRow feeds into the income-statement model.

import {
  EXPENSE_CATEGORIES,
  expenseCategoryLabel,
  isExpenseCategory,
  type ExpenseCategory,
} from "./expenses";
import { filterByWindow, windowStartMs, type WindowDays } from "./reports";
import type { CategorizationRule } from "./categorization-rules";

export const SPEND_WINDOWS = ["this_month", "last_3", "last_6", "last_12"] as const;
export type SpendWindow = (typeof SPEND_WINDOWS)[number];

export type SpendRange = {
  from: string;
  to: string;
  label: string;
};

export type SpendExpenseRow = {
  id?: string;
  category: string;
  amount_cents: number;
  incurred_on: string;
  merchant?: string | null;
  note?: string | null;
  source?: string | null;
  property_id?: string | null;
  building_key?: string | null;
  bank_transaction_id?: string | null;
  stream_id?: string | null;
  account_name?: string | null;
};

export type SpendCategoryRow = {
  category: ExpenseCategory;
  label: string;
  totalCents: number;
  count: number;
  sharePct: number;
};

export type SpendByCategoryResult = {
  window: SpendWindow;
  range: SpendRange;
  totalCents: number;
  count: number;
  rows: SpendCategoryRow[];
};

export type SpendTrendRow = {
  month: string;
  label: string;
  totalCents: number;
  count: number;
};

export type SpendTrendResult = {
  window: SpendWindow;
  range: SpendRange;
  granularity: "month";
  totalCents: number;
  rows: SpendTrendRow[];
};

export type RecurringSpendRow = {
  streamId: string;
  merchant: string;
  category: ExpenseCategory;
  label: string;
  totalCents: number;
  count: number;
  lastAmountCents: number | null;
  lastDate: string | null;
  cadenceLabel: string;
  propertyId: string | null;
  buildingKey: string | null;
  source: "ledger" | "rule";
};

const DAY_MS = 24 * 60 * 60 * 1000;

const WINDOW_LABELS: Record<SpendWindow, string> = {
  this_month: "This month",
  last_3: "Last 3 months",
  last_6: "Last 6 months",
  last_12: "Last 12 months",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDateFromIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function monthKey(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : "unknown";
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map((v) => Number(v));
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function addMonthsUtc(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

export function parseSpendWindow(raw: string | undefined | null): SpendWindow {
  return (SPEND_WINDOWS as readonly string[]).includes(raw ?? "")
    ? (raw as SpendWindow)
    : "last_3";
}

export function spendWindowLabel(window: SpendWindow): string {
  return WINDOW_LABELS[window];
}

export function spendWindowRange(window: SpendWindow, now: Date = new Date()): SpendRange {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = isoDate(today);
  if (window === "this_month") {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from: isoDate(from), to, label: WINDOW_LABELS[window] };
  }

  const nowMs = today.getTime();
  let startMs: number;
  if (window === "last_3") {
    startMs = windowStartMs(90 satisfies WindowDays, nowMs);
  } else if (window === "last_12") {
    startMs = windowStartMs(365 satisfies WindowDays, nowMs);
  } else {
    startMs = nowMs - 180 * DAY_MS;
  }
  return {
    from: isoDate(new Date(startMs)),
    to,
    label: WINDOW_LABELS[window],
  };
}

function rowDate(row: SpendExpenseRow): string {
  return row.incurred_on;
}

function inIsoRange(iso: string, range: SpendRange): boolean {
  return iso >= range.from && iso <= range.to;
}

export function expensesForSpendWindow<T extends SpendExpenseRow>(
  expenses: readonly T[],
  window: SpendWindow,
  now: Date = new Date(),
): T[] {
  const range = spendWindowRange(window, now);
  if (window === "this_month") {
    return expenses.filter((row) => inIsoRange(rowDate(row), range));
  }

  const startMs = Date.parse(`${range.from}T00:00:00.000Z`);
  const rowsWithCreated = expenses.map((row) => ({
    ...row,
    created_at: `${rowDate(row)}T00:00:00.000Z`,
  }));
  return filterByWindow(rowsWithCreated, startMs).filter((row) =>
    inIsoRange(rowDate(row), range),
  );
}

function normalizedCategory(category: string): ExpenseCategory {
  return isExpenseCategory(category) ? category : "other";
}

function sharePct(cents: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((cents / total) * 1000) / 10;
}

export function spendByCategory(
  expenses: readonly SpendExpenseRow[],
  window: SpendWindow = "last_3",
  now: Date = new Date(),
): SpendByCategoryResult {
  const range = spendWindowRange(window, now);
  const inWindow = expensesForSpendWindow(expenses, window, now);
  const byCategory = new Map<ExpenseCategory, { totalCents: number; count: number }>();

  for (const row of inWindow) {
    const amount = Math.max(0, Math.trunc(row.amount_cents));
    const category = normalizedCategory(row.category);
    const current = byCategory.get(category) ?? { totalCents: 0, count: 0 };
    current.totalCents += amount;
    current.count += 1;
    byCategory.set(category, current);
  }

  const totalCents = [...byCategory.values()].reduce((sum, row) => sum + row.totalCents, 0);
  const rows = EXPENSE_CATEGORIES.map((category) => {
    const value = byCategory.get(category) ?? { totalCents: 0, count: 0 };
    return {
      category,
      label: expenseCategoryLabel(category),
      totalCents: value.totalCents,
      count: value.count,
      sharePct: sharePct(value.totalCents, totalCents),
    };
  })
    .filter((row) => row.totalCents > 0 || row.count > 0)
    .sort((a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label));

  return {
    window,
    range,
    totalCents,
    count: inWindow.length,
    rows,
  };
}

function monthsBetween(range: SpendRange): string[] {
  const start = utcDateFromIso(range.from);
  const end = utcDateFromIso(range.to);
  if (!start || !end) return [];

  const months: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor.getTime() <= endMonth.getTime()) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor = addMonthsUtc(cursor, 1);
  }
  return months;
}

export function spendTrend(
  expenses: readonly SpendExpenseRow[],
  window: SpendWindow = "last_6",
  granularity: "month" = "month",
  now: Date = new Date(),
): SpendTrendResult {
  const range = spendWindowRange(window, now);
  const inWindow = expensesForSpendWindow(expenses, window, now);
  const byMonth = new Map<string, { totalCents: number; count: number }>();

  for (const row of inWindow) {
    const key = monthKey(row.incurred_on);
    if (key === "unknown") continue;
    const current = byMonth.get(key) ?? { totalCents: 0, count: 0 };
    current.totalCents += Math.max(0, Math.trunc(row.amount_cents));
    current.count += 1;
    byMonth.set(key, current);
  }

  const rows = monthsBetween(range).map((month) => {
    const value = byMonth.get(month) ?? { totalCents: 0, count: 0 };
    return {
      month,
      label: monthLabel(month),
      totalCents: value.totalCents,
      count: value.count,
    };
  });

  return {
    window,
    range,
    granularity,
    totalCents: rows.reduce((sum, row) => sum + row.totalCents, 0),
    rows,
  };
}

function merchantLabel(row: SpendExpenseRow | null, rule: CategorizationRule | null, streamId: string): string {
  const merchant = (row?.merchant ?? "").trim();
  if (merchant) return merchant;
  const note = (row?.note ?? "").trim();
  if (note) return note;
  const norm = (rule?.merchantNorm ?? "").trim();
  if (norm) return norm.replace(/\b\w/g, (char) => char.toUpperCase());
  return streamId;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function cadenceLabel(dates: string[]): string {
  const uniqueTimes = Array.from(
    new Set(
      dates
        .map((d) => utcDateFromIso(d)?.getTime() ?? null)
        .filter((t): t is number => t != null),
    ),
  ).sort((a, b) => a - b);
  if (uniqueTimes.length < 2) return "Recurring stream";

  const gaps = uniqueTimes.slice(1).map((time, index) =>
    Math.round((time - uniqueTimes[index]) / DAY_MS),
  );
  const gap = median(gaps);
  if (gap >= 6 && gap <= 8) return "Weekly";
  if (gap >= 13 && gap <= 16) return "Every 2 weeks";
  if (gap >= 27 && gap <= 35) return "Monthly";
  if (gap >= 80 && gap <= 100) return "Quarterly";
  if (gap >= 350 && gap <= 380) return "Yearly";
  return `Every ${gap} days`;
}

function ruleAmount(rule: CategorizationRule): number | null {
  if (rule.amountMinCents != null && rule.amountMaxCents != null) {
    return Math.round((rule.amountMinCents + rule.amountMaxCents) / 2);
  }
  return rule.amountMinCents ?? rule.amountMaxCents ?? null;
}

export function recurringSpend(
  expenses: readonly SpendExpenseRow[],
  rules: readonly CategorizationRule[] = [],
): RecurringSpendRow[] {
  const rulesByStream = new Map(
    rules
      .filter((rule) => rule.streamId)
      .map((rule) => [rule.streamId as string, rule]),
  );
  const expensesByStream = new Map<string, SpendExpenseRow[]>();
  for (const row of expenses) {
    const streamId = (row.stream_id ?? "").trim();
    if (!streamId) continue;
    const group = expensesByStream.get(streamId) ?? [];
    group.push(row);
    expensesByStream.set(streamId, group);
  }

  const streamIds = new Set<string>([...expensesByStream.keys(), ...rulesByStream.keys()]);
  const rows: RecurringSpendRow[] = [];
  for (const streamId of streamIds) {
    const group = [...(expensesByStream.get(streamId) ?? [])].sort((a, b) =>
      a.incurred_on.localeCompare(b.incurred_on),
    );
    const rule = rulesByStream.get(streamId) ?? null;
    const latest = group[group.length - 1] ?? null;
    const category = normalizedCategory(latest?.category ?? rule?.category ?? "other");
    const amountFromRule = rule ? ruleAmount(rule) : null;
    rows.push({
      streamId,
      merchant: merchantLabel(latest, rule, streamId),
      category,
      label: expenseCategoryLabel(category),
      totalCents: group.reduce((sum, row) => sum + Math.max(0, Math.trunc(row.amount_cents)), 0),
      count: group.length,
      lastAmountCents: latest ? Math.max(0, Math.trunc(latest.amount_cents)) : amountFromRule,
      lastDate: latest?.incurred_on ?? null,
      cadenceLabel: cadenceLabel(group.map((row) => row.incurred_on)),
      propertyId: latest?.property_id ?? rule?.propertyId ?? null,
      buildingKey: latest?.building_key ?? rule?.buildingKey ?? null,
      source: group.length > 0 ? "ledger" : "rule",
    });
  }

  return rows.sort((a, b) => {
    const aDate = a.lastDate ?? "";
    const bDate = b.lastDate ?? "";
    return bDate.localeCompare(aDate) || b.totalCents - a.totalCents || a.merchant.localeCompare(b.merchant);
  });
}
