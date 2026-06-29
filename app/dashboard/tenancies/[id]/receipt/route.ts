import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import {
  buildRentReceiptModel,
  renderRentReceiptHtml,
  defaultReceiptYear,
  type RentReceiptPayment,
} from "@/lib/rent-receipt";

export const dynamic = "force-dynamic";

// Render an annual rent receipt ("Statement of Rent Paid") for a tenancy as a
// standalone, print-optimized HTML document (S382). The operator opens it in a
// new tab from the per-tenancy "Payments received" section, reviews it, and
// Prints -> Saves as PDF to give the tenant for their taxes.
//
// Mirrors the N1 print route: read-only; guarded on manage_tenancies; RLS scopes
// every query to the caller's org. The receipt is built purely from the
// rent_payments ledger the operator already maintains (lib/rent-receipt.ts), so
// the printed totals never drift from the Payments section.
//
// ?year=YYYY selects the calendar year; absent/invalid -> the most recent year
// that has payments (else the current year), so a bare link still works.

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!(await currentUserCan("manage_tenancies"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = createClient();

  // RLS scopes to this org. Tenant names + unit address for the receipt header.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select("id, property:properties(address), tenants(name, is_primary)")
    .eq("id", params.id)
    .maybeSingle();
  if (!tenancyRow) return new NextResponse("Tenancy not found", { status: 404 });

  const tenancy = tenancyRow as unknown as {
    property: { address: string | null } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };

  // The full payment ledger for this tenancy (RLS-scoped). We filter to the year
  // in pure code so the available-years default is computed from real data.
  const { data: paymentRows } = await supabase
    .from("rent_payments")
    .select("amount_cents, method, paid_on, period_month, reference, note")
    .eq("tenancy_id", params.id)
    .order("paid_on", { ascending: true });
  const payments = (paymentRows ?? []) as RentReceiptPayment[];

  // Year: explicit ?year= if it's a sane 4-digit year, else the smart default.
  const currentYear = Number(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 4),
  );
  const rawYear = req.nextUrl.searchParams.get("year");
  const parsedYear = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
  const year =
    parsedYear != null && parsedYear >= 1900 && parsedYear <= 2200
      ? parsedYear
      : defaultReceiptYear(payments, currentYear);

  const tenantNames = (tenancy.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((t) => (t.name ?? "").trim())
    .filter((n) => n.length > 0);

  const model = buildRentReceiptModel({
    landlordName: org.name,
    landlordPhone: org.public_contact_phone ?? null,
    landlordEmail: org.public_contact_email ?? null,
    landlordLogoUrl: org.logo_url ?? null,
    brandColor: org.brand_color ?? null,
    tenantNames,
    rentalUnitAddress: tenancy.property?.address ?? null,
    year,
    payments,
    generatedAtIso: new Date().toISOString(),
  });

  return new NextResponse(renderRentReceiptHtml(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
