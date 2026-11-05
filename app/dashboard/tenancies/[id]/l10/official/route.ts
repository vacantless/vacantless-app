import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import { computeL10 } from "@/lib/l10";
import { fillOfficialL10 } from "@/lib/l10-official-pdf";
import { type L1FilingMethod } from "@/lib/l1";
import { parseAmountToCents, parseDateOrNull, type PaymentRow } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S751: build the official Form L10 (2026/09) for a tenant who moved out: rent
// owing from the ledger counted to the move-out date, plus any damage or
// interference costs the landlord enters. POST (contact details and addresses
// stay out of the URL). Returns the PDF for the landlord to sign and file;
// nothing is stored or filed. manage_tenancies only; RLS scopes every read.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (await postLeaseRouteWalled()) return new Response("Not found", { status: 404 });
  if (!(await currentUserCan("manage_tenancies"))) return new NextResponse("Forbidden", { status: 403 });

  const form = await req.formData();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/dashboard/tenancies/${params.id}?l10=${q}#notices`, req.url), 303);

  const method: L1FilingMethod = s("method") === "paper" ? "paper" : "portal";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const moveOutISO = parseDateOrNull(s("move_out"));

  const supabase = createClient();
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, rent_cents, start_date, deposit_cents, property:properties(address), tenants(name, email, phone, is_primary)")
    .eq("id", params.id)
    .maybeSingle();
  const t = tRow as unknown as {
    rent_cents: number | null;
    start_date: string | null;
    deposit_cents: number | null;
    property: { address: string | null } | null;
    tenants: { name: string | null; email: string | null; phone: string | null; is_primary: boolean }[];
  } | null;
  if (!t) return back("not_reconciling");

  const { data: payRows } = await supabase
    .from("rent_payments")
    .select("amount_cents, period_month")
    .eq("tenancy_id", params.id);
  const payments: PaymentRow[] = (payRows ?? []).map((p) => {
    const r = p as { amount_cents: number; period_month: string | null };
    return { amount_cents: r.amount_cents, period_month: r.period_month };
  });

  const tenants = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .filter((x) => (x.name ?? "").trim())
    .map((x) => ({ name: (x.name as string).trim(), email: x.email, phone: x.phone }));
  if (tenants.length === 0) return back("not_reconciling");

  const damageDetail = String(form.get("damage_detail") ?? "").trim().slice(0, 3000);
  const interferenceDetail = String(form.get("interference_detail") ?? "").trim().slice(0, 3000);
  const calc = computeL10({
    moveOutISO,
    filingDateISO: today,
    method,
    tenantCount: tenants.length,
    rentCents: t.rent_cents,
    startDateISO: t.start_date,
    payments,
    damageCents: parseAmountToCents(s("damage_cost")) ?? 0,
    damageDetail,
    interferenceCents: parseAmountToCents(s("interference_cost")) ?? 0,
    interferenceDetail,
  });
  if (calc.problems.length > 0) return back(calc.problems[0]);

  const currentAddress = s("tenant_address").slice(0, 300) || null;
  const unit = (t.property?.address ?? "").replace(/\W/g, "").toLowerCase();
  if (currentAddress && unit && currentAddress.replace(/\W/g, "").toLowerCase() === unit) return back("same_address");

  const depositCents = parseAmountToCents(s("deposit_amount")) ?? t.deposit_cents ?? 0;
  const bytes = await fillOfficialL10({
    rentalUnitAddress: t.property?.address ?? null,
    moveOutISO: calc.moveOutISO,
    landlord: {
      firstName: s("landlord_first") || null,
      lastName: s("landlord_last") || null,
      company: s("landlord_company") || null,
      email: s("landlord_email") || null,
      phone: s("landlord_phone") || null,
      mailingAddress: s("landlord_address") || null,
      byEmail: s("by_email") === "yes",
    },
    tenants,
    tenantCurrentAddress: currentAddress,
    deposit: depositCents > 0
      ? {
          cents: depositCents,
          collectedISO: parseDateOrNull(s("deposit_date")),
          interestFromISO: parseDateOrNull(s("interest_from")),
          interestToISO: parseDateOrNull(s("interest_to")),
        }
      : null,
    rows: calc.rows,
    rentOwingCents: calc.rentOwingCents,
    damageCents: calc.damageCents,
    damageDetail,
    interferenceCents: calc.interferenceCents,
    interferenceDetail,
    feeCents: calc.feeCents,
    totalCents: calc.totalCents,
  });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-L10-Application-Former-Tenant.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
