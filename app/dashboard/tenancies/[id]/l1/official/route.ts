import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import { computeL1, n4ConcessionCents, type L1FilingMethod } from "@/lib/l1";
import { fillOfficialL1 } from "@/lib/l1-official-pdf";
import { parseAmountToCents, parseDateOrNull, type PaymentRow } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S748g: build the official Form L1 (2026/09) from a served N4 and the rent
// ledger counted to the filing date. POST (the landlord's contact details stay
// out of the URL). Returns the PDF for the landlord to sign and file; nothing is
// filed for them. manage_tenancies only; RLS scopes every read to the caller's org.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (await postLeaseRouteWalled()) return new Response("Not found", { status: 404 });
  if (!(await currentUserCan("manage_tenancies"))) return new NextResponse("Forbidden", { status: 403 });

  const form = await req.formData();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/dashboard/tenancies/${params.id}?l1=${q}#notices`, req.url), 303);

  const noticeId = s("notice_id");
  const method: L1FilingMethod = s("method") === "paper" ? "paper" : "portal";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const filingDateISO = parseDateOrNull(s("filing_date")) ?? today;

  const supabase = createClient();
  const { data: n } = await supabase
    .from("notices")
    .select("id, type, status, termination_date, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  const notice = n as {
    type: string;
    status: string;
    termination_date: string | null;
    snapshot: { conservativeOwingCents?: number | null; totalOwingCents?: number | null } | null;
  } | null;
  if (!notice || notice.type !== "N4" || !notice.termination_date) return back("n4_not_served");

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
  if (!t || t.rent_cents == null || !t.start_date) return back("not_reconciling");

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

  const calc = computeL1({
    n4Status: notice.status,
    n4TerminationISO: notice.termination_date,
    filingDateISO,
    method,
    tenantInPossession: s("in_possession") === "yes",
    tenantCount: tenants.length,
    rentCents: t.rent_cents,
    startDateISO: t.start_date,
    payments,
    n4ConcessionCents: n4ConcessionCents(notice.snapshot),
  });
  if (calc.problems.length > 0) return back(calc.problems[0]);

  const depositCents = parseAmountToCents(s("deposit_amount")) ?? t.deposit_cents ?? 0;
  const bytes = await fillOfficialL1({
    rentalUnitAddress: t.property?.address ?? null,
    filingDateISO,
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
    nsfCents: calc.nsfCents,
    feeCents: calc.feeCents,
    totalCents: calc.totalCents,
  });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-L1-Application-Non-payment.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
