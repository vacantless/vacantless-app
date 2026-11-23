// S836e: read the expense report's filters from a URL, the same way for the
// page and the CSV, so both always show the same lines. Pure.
import { STATEMENT_PRESETS, parseRangeBound, rangeForPreset, type DateRange } from "@/lib/statements";

export type ExpenseReportParams = { preset: string; range: DateRange; propertyId: string | null; category: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readExpenseReportParams(get: (k: string) => string | null | undefined, todayIso: string): ExpenseReportParams {
  const raw = get("preset") ?? "this_year";
  const preset = (STATEMENT_PRESETS as readonly string[]).includes(raw) ? raw : "this_year";
  const range = rangeForPreset(preset, todayIso, { from: parseRangeBound(get("from")), to: parseRangeBound(get("to")) });
  const unit = get("unit") ?? "";
  const cat = (get("category") ?? "").trim();
  return { preset, range, propertyId: UUID.test(unit) ? unit : null, category: /^[a-z_]{1,40}$/.test(cat) ? cat : null };
}

export function expenseReportQuery(p: ExpenseReportParams): string {
  const q = new URLSearchParams();
  q.set("preset", p.preset);
  if (p.preset === "custom") {
    if (p.range.from) q.set("from", p.range.from);
    if (p.range.to) q.set("to", p.range.to);
  }
  if (p.propertyId) q.set("unit", p.propertyId);
  if (p.category) q.set("category", p.category);
  return q.toString();
}
