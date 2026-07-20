import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { planEntitlements } from "@/lib/billing";
import { expenseToCostRow, isOperatingCategory, type ExpenseRow } from "@/lib/expenses";
import { parseMoneyToCents } from "@/lib/tenancy";
import {
  buildMonthlyStatement,
  buildOwnerStatement,
  describeRange,
  statementToCsv,
  type DateRange,
  type PropertyRef,
  type RentRow,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import { buildIncomeStatement, incomeStatementToCsv } from "@/lib/income-statement";
import { buildT776Statement, t776ToCsv } from "@/lib/t776";
import {
  buildRentRoll,
  computeCapRate,
  rangeDays,
  rentRollToCsv,
  type RentRollPropertyRef,
  type RentRollTenancyInput,
} from "@/lib/rent-roll";
import {
  accountantPackageReadme,
  buildGeneralLedger,
  generalLedgerToCsv,
  ledgerToQuickBooksCsv,
  ledgerToXeroCsv,
  type LedgerExpenseRow,
  type LedgerWorkOrderRow,
} from "@/lib/accountant-package";
import { buildZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";

// S532 accountant hand-off package (Premium accounting + view_reports): ONE
// zip with every year-end artifact — general ledger, T776, P&L, owner
// statement, rent roll, QuickBooks/Xero import CSVs, and a README explaining
// the basis rules. Reads RLS-scoped rows once and feeds the existing PURE
// report builders; the only new math (the general ledger) reconciles to them
// by construction. Nothing is written anywhere.

type RentQueryRow = {
  amount_cents: number;
  paid_on: string | null;
  tenancy: { property_id: string | null } | null;
};

type WoQueryRow = {
  property_id: string | null;
  building_key: string | null;
  category: string;
  status: string;
  cost_cents: number | null;
  completed_on: string | null;
  title: string | null;
  tenancy: { property_id: string | null } | null;
};

type ExpenseQueryRow = ExpenseRow & { merchant: string | null; note: string | null };

type TenantRow = { name: string | null; is_primary: boolean };
type TenancyQueryRow = {
  status: string;
  rent_cents: number | null;
  start_date: string | null;
  end_date: string | null;
  property_id: string | null;
  tenants: TenantRow[];
};

function parseYear(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1900 && year <= 9999 ? year : null;
}

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!planEntitlements(org.plan).accounting) {
    return new NextResponse("Upgrade to Premium to export the accountant package.", { status: 403 });
  }
  if (!(await currentUserCan("view_reports"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const year = parseYear(req.nextUrl.searchParams.get("year")) ?? Number(todayIso.slice(0, 4));
  const range: DateRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  const valueDollars = (req.nextUrl.searchParams.get("value") ?? "").trim();
  const propertyValueCents = parseMoneyToCents(valueDollars);

  const supabase = createClient();
  const [{ data: rentData }, { data: woData }, { data: expData }, { data: propData }, { data: tenData }] =
    await Promise.all([
      supabase
        .from("rent_payments")
        .select("amount_cents, paid_on, tenancy:tenancies(property_id)"),
      supabase
        .from("work_orders")
        .select(
          "property_id, building_key, category, status, cost_cents, completed_on, title, tenancy:tenancies(property_id)",
        ),
      supabase
        .from("expenses")
        .select("property_id, building_key, category, amount_cents, incurred_on, merchant, note"),
      supabase
        .from("properties")
        .select("id, address, building_key, rent_cents")
        .order("address", { ascending: true }),
      supabase
        .from("tenancies")
        .select("status, rent_cents, start_date, end_date, property_id, tenants(name, is_primary)"),
    ]);

  const propRows = (propData ?? []) as {
    id: string;
    address: string;
    building_key: string | null;
    rent_cents: number | null;
  }[];
  const properties: PropertyRef[] = propRows.map((p) => ({
    id: p.id,
    address: p.address,
    buildingKey: p.building_key,
  })) as PropertyRef[];

  const rentRows: RentRow[] = ((rentData ?? []) as unknown as RentQueryRow[]).map((r) => ({
    amount_cents: r.amount_cents,
    paid_on: r.paid_on,
    property_id: r.tenancy?.property_id ?? null,
  }));

  const rawWoRows = (woData ?? []) as unknown as WoQueryRow[];
  const woRows: LedgerWorkOrderRow[] = rawWoRows.map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    building_key: w.building_key,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
    title: w.title,
  }));

  const rawExpenseRows = (expData ?? []) as unknown as ExpenseQueryRow[];
  const expenseCostRows: WorkOrderCostRow[] = rawExpenseRows.map((e) => expenseToCostRow(e));
  const ledgerExpenseRows: LedgerExpenseRow[] = rawExpenseRows.map((e) => ({
    property_id: e.property_id,
    building_key: e.building_key ?? null,
    category: e.category,
    amount_cents: e.amount_cents,
    incurred_on: e.incurred_on,
    merchant: e.merchant,
    note: e.note,
  }));

  const allCostRows = [...woRows, ...expenseCostRows];

  // Summaries — all existing pure builders, same inputs the standalone
  // report routes feed them.
  const ownerStatement = buildOwnerStatement(rentRows, allCostRows, properties, range);
  const monthly = buildMonthlyStatement(rentRows, allCostRows, properties, range);
  const incomeStatement = buildIncomeStatement(rentRows, allCostRows, properties, range);
  const t776 = buildT776Statement(rentRows, allCostRows, properties, year);

  const rollProperties: RentRollPropertyRef[] = propRows.map((p) => ({
    id: p.id,
    address: p.address,
    buildingKey: p.building_key,
    askingRentCents: p.rent_cents,
  })) as RentRollPropertyRef[];
  const tenancies: RentRollTenancyInput[] = ((tenData ?? []) as unknown as TenancyQueryRow[]).map((t) => {
    const tenants = t.tenants ?? [];
    const primary = tenants.find((x) => x.is_primary) ?? tenants[0] ?? null;
    return {
      propertyId: t.property_id,
      status: t.status,
      rentCents: t.rent_cents,
      startDate: t.start_date,
      endDate: t.end_date,
      primaryTenantName: primary?.name ?? null,
      coTenantCount: Math.max(0, tenants.length - 1),
    };
  });
  const roll = buildRentRoll(rollProperties, tenancies);
  const operatingCostRows = allCostRows.filter((r) => isOperatingCategory(r.category));
  const opStatement = buildOwnerStatement([], operatingCostRows, properties, range);
  const cap = computeCapRate({
    annualOperatingIncomeCents: roll.inPlaceAnnualRentCents,
    operatingExpensesCents: opStatement.totals.maintenanceOutCents,
    windowDays: rangeDays(range.from, range.to),
    propertyValueCents,
  });

  // The transaction detail underneath those summaries.
  const ledger = buildGeneralLedger(rentRows, ledgerExpenseRows, woRows, propRows, range);

  const entries: ZipEntry[] = [
    {
      name: "README.txt",
      data: accountantPackageReadme({
        orgName: org.name,
        range,
        generatedOn: todayIso,
        entryCount: ledger.length,
      }),
    },
    { name: "general-ledger.csv", data: generalLedgerToCsv(ledger, range) },
    { name: "t776-tax-package.csv", data: t776ToCsv(t776) },
    { name: "income-statement.csv", data: incomeStatementToCsv(incomeStatement) },
    { name: "owner-statement.csv", data: statementToCsv(ownerStatement, monthly) },
    {
      name: "rent-roll.csv",
      data: rentRollToCsv(roll, {
        expensePeriod: describeRange(range),
        propertyValueCents,
        operatingExpensesCents: opStatement.totals.maintenanceOutCents,
        cap,
      }),
    },
    { name: "quickbooks-transactions.csv", data: ledgerToQuickBooksCsv(ledger) },
    { name: "xero-transactions.csv", data: ledgerToXeroCsv(ledger) },
  ];

  const zip = buildZip(entries, todayIso);

  return new NextResponse(Buffer.from(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="accountant-package-${year}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
