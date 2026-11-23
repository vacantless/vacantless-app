// S836e: read one account's cost lines for the expense report
// (lib/expense-report.ts). The same rows Money > Income statement reads
// (expenses and repairs with a cost and a completed date), scoped to the one
// account, so the two always agree.
import type { SupabaseClient } from "@supabase/supabase-js";
import { expenseCategoryLabel, isExpenseCategory } from "@/lib/expenses";
import { workOrderCategoryLabel, workOrderScope } from "@/lib/work-orders";
import { shortAddr } from "@/lib/rental-report";
import type { ExpenseLine } from "@/lib/expense-report";

export function costCategoryLabel(category: string): string {
  return isExpenseCategory(category) ? expenseCategoryLabel(category) : workOrderCategoryLabel(category);
}

export async function loadExpenseLines(
  db: SupabaseClient,
  orgId: string,
): Promise<{ lines: ExpenseLine[]; units: { id: string; label: string }[] }> {
  const [expRes, woRes, propRes] = await Promise.all([
    db.from("expenses").select("property_id, building_key, category, amount_cents, incurred_on, merchant, note").eq("organization_id", orgId),
    db
      .from("work_orders")
      .select("property_id, building_key, category, cost_cents, completed_on, title, tenancy:tenancies(property_id)")
      .eq("organization_id", orgId)
      .not("cost_cents", "is", null)
      .not("completed_on", "is", null),
    db.from("properties").select("id, address").eq("organization_id", orgId).order("address", { ascending: true }),
  ]);
  const props = (propRes.data ?? []) as { id: string; address: string | null }[];
  const label = new Map(props.map((p) => [p.id, shortAddr(p.address)]));
  const where = (pid: string | null, bkey: string | null) => {
    const scope = workOrderScope({ property_id: pid, building_key: bkey });
    if (scope === "unit" && pid) return label.get(pid) ?? "A unit";
    if (scope === "building") return "Building-wide";
    return "Not tied to a unit";
  };

  const lines: ExpenseLine[] = [];
  for (const e of (expRes.data ?? []) as {
    property_id: string | null;
    building_key: string | null;
    category: string;
    amount_cents: number;
    incurred_on: string;
    merchant: string | null;
    note: string | null;
  }[]) {
    lines.push({
      source: "expense",
      category: e.category,
      categoryLabel: costCategoryLabel(e.category),
      amountCents: e.amount_cents,
      day: e.incurred_on,
      merchant: e.merchant,
      detail: e.note,
      where: where(e.property_id, e.building_key),
      propertyId: e.property_id,
    });
  }
  for (const w of (woRes.data ?? []) as unknown as {
    property_id: string | null;
    building_key: string | null;
    category: string;
    cost_cents: number;
    completed_on: string;
    title: string | null;
    tenancy: { property_id: string | null } | null;
  }[]) {
    const pid = w.property_id ?? w.tenancy?.property_id ?? null;
    lines.push({
      source: "repair",
      category: w.category,
      categoryLabel: costCategoryLabel(w.category),
      amountCents: w.cost_cents,
      day: w.completed_on,
      merchant: null,
      detail: w.title,
      where: where(pid, w.building_key),
      propertyId: pid,
    });
  }
  // Units that have at least one cost line, for the filter.
  const withCost = new Set(lines.map((l) => l.propertyId).filter((x): x is string => !!x));
  return { lines, units: props.filter((p) => withCost.has(p.id)).map((p) => ({ id: p.id, label: label.get(p.id) as string })) };
}
