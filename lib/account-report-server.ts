// S836b: read one account's records for the monthly summary
// (lib/account-report.ts). Works with the service-role client (the 1st-of-month
// sweep) and with a signed-in client (the Reports page): every read is scoped
// to the one account. Books come from the same income statement model and the
// same rows as Money > Income statement, so the two always agree.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAccountReport, type AccountReport } from "@/lib/account-report";
import { canUseBooks } from "@/lib/billing";
import { buildIncomeStatement } from "@/lib/income-statement";
import { expenseToCostRow, expenseCategoryLabel, isExpenseCategory, type ExpenseRow } from "@/lib/expenses";
import { workOrderCategoryLabel } from "@/lib/work-orders";
import type { DateRange, PropertyRef, RentRow } from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import type { LeadLite } from "@/lib/reports";
import type { CostLite } from "@/lib/channel-costs";
import { loadAdsDown } from "@/lib/ads-down-server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

type RentQueryRow = { amount_cents: number; paid_on: string | null; tenancy: { property_id: string | null } | null };
type WoQueryRow = {
  property_id: string | null;
  building_key: string | null;
  category: string;
  status: string;
  cost_cents: number | null;
  completed_on: string | null;
  tenancy: { property_id: string | null } | null;
};

function lastDayBefore(isoExclusive: string): string {
  const d = new Date(`${isoExclusive}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function loadAccountReport(
  db: SupabaseClient,
  org: { id: string; name: string | null; plan: string | null; viewings_by_request?: boolean | null },
  range: { monthStart: string; monthEnd: string },
  today: string,
): Promise<AccountReport> {
  const orgId = org.id;
  const books = canUseBooks({ plan: org.plan });
  const [propsRes, outRes, leadsRes, showRes, costRes, rentRes, woRes, expRes] = await Promise.all([
    db.from("properties").select("id, address, status, available_since, building_key, archived_at").eq("organization_id", orgId),
    db
      .from("leased_outcomes")
      .select("property_id, address, available_since, leased_at, days_on_market")
      .eq("organization_id", orgId)
      .gte("leased_at", range.monthStart)
      .lt("leased_at", range.monthEnd),
    db.from("leads").select("id, source, status, created_at, leased_date, property_id").eq("organization_id", orgId),
    db.from("showings").select("property_id, scheduled_at, outcome").eq("organization_id", orgId).gte("scheduled_at", range.monthStart).lt("scheduled_at", range.monthEnd),
    db.from("marketing_costs").select("portal, label, amount_cents, spent_on").eq("organization_id", orgId),
    books
      ? db.from("rent_payments").select("amount_cents, paid_on, tenancy:tenancies(property_id)").eq("organization_id", orgId)
      : Promise.resolve({ data: [] as unknown[] }),
    books
      ? db
          .from("work_orders")
          .select("property_id, building_key, category, status, cost_cents, completed_on, tenancy:tenancies(property_id)")
          .eq("organization_id", orgId)
      : Promise.resolve({ data: [] as unknown[] }),
    books
      ? db.from("expenses").select("property_id, building_key, category, amount_cents, incurred_on").eq("organization_id", orgId)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  type PropRow = { id: string; address: string | null; status: string | null; available_since: string | null; building_key: string | null; archived_at: string | null };
  const props = ((propsRes.data ?? []) as PropRow[]).filter((p) => !p.archived_at);

  let bookTotals: Parameters<typeof buildAccountReport>[0]["books"] = null;
  let adExpenses: { amountCents: number; day: string }[] = [];
  if (books) {
    const properties: PropertyRef[] = props.map((p) => ({ id: p.id, address: p.address ?? "", buildingKey: p.building_key }));
    const rentRows: RentRow[] = ((rentRes.data ?? []) as unknown as RentQueryRow[]).map((r) => ({
      amount_cents: r.amount_cents,
      paid_on: r.paid_on,
      property_id: r.tenancy?.property_id ?? null,
    }));
    const woRows: WorkOrderCostRow[] = ((woRes.data ?? []) as unknown as WoQueryRow[]).map((w) => ({
      property_id: w.property_id ?? w.tenancy?.property_id ?? null,
      building_key: w.building_key,
      category: w.category,
      status: w.status,
      cost_cents: w.cost_cents,
      completed_on: w.completed_on,
    }));
    const expenseRows = (expRes.data ?? []) as unknown as ExpenseRow[];
    const costRows: WorkOrderCostRow[] = [...woRows, ...expenseRows.map((e) => expenseToCostRow(e))];
    const lastDay = lastDayBefore(range.monthEnd);
    const monthRange: DateRange = { from: range.monthStart, to: lastDay };
    const ytdRange: DateRange = { from: `${range.monthStart.slice(0, 4)}-01-01`, to: lastDay };
    // Same labels as Money > Income statement.
    const label = (c: string) => (isExpenseCategory(c) ? expenseCategoryLabel(c) : workOrderCategoryLabel(c));
    const totals = (r: DateRange) => {
      const st = buildIncomeStatement(rentRows, costRows, properties, r);
      const t = st.totals;
      return {
        rentCents: t.revenueCents,
        expenseCents: t.operatingExpensesCents,
        rentCount: t.rentCount,
        expenseCount: t.expenseCount,
        categories: st.operatingCategories.map((c) => ({ label: label(c.category), cents: c.totalCents })),
      };
    };
    bookTotals = { month: totals(monthRange), ytd: totals(ytdRange) };
    adExpenses = expenseRows.filter((e) => e.category === "advertising").map((e) => ({ amountCents: e.amount_cents, day: e.incurred_on }));
  }

  const adsDown = await loadAdsDown(db, orgId);

  return buildAccountReport({
    orgName: org.name,
    monthStart: range.monthStart,
    monthEnd: range.monthEnd,
    today,
    properties: props.map((p) => ({ id: p.id, address: p.address, status: p.status, availableSince: p.available_since })),
    outcomes: ((outRes.data ?? []) as { property_id: string | null; address: string | null; available_since: string | null; leased_at: string; days_on_market: number | null }[]).map(
      (o) => ({ propertyId: o.property_id, address: o.address, availableSince: o.available_since, leasedAt: o.leased_at, daysOnMarket: o.days_on_market }),
    ),
    leads: (leadsRes.data ?? []) as LeadLite[],
    showings: ((showRes.data ?? []) as { property_id: string | null; scheduled_at: string | null; outcome: string | null }[]).map((s) => ({
      propertyId: s.property_id,
      scheduledAt: s.scheduled_at,
      outcome: s.outcome,
    })),
    costs: (costRes.data ?? []) as CostLite[],
    books: bookTotals,
    adExpenses,
    reportsUrl: `${APP_URL}/dashboard/reports`,
    viewingsByRequest: org.viewings_by_request === true,
    adsDown,
    rentalUrl: (id) => `${APP_URL}/dashboard/properties/${id}`,
    expenseReportUrl: `${APP_URL}/dashboard/money/expense-report?preset=custom&from=${range.monthStart.slice(0, 4)}-01-01&to=${lastDayBefore(range.monthEnd)}`,
  });
}
