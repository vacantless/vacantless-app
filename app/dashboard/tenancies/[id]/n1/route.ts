import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { formatRentCents } from "@/lib/tenancy";
import { deriveRentIncrease } from "@/lib/rent-increase";
import { renderN1Html, type N1RenderModel } from "@/lib/n1-render";

export const dynamic = "force-dynamic";

// Render a PRE-FILLED Ontario Form N1 (Notice of Rent Increase) as a standalone,
// print-optimized HTML document — N1 PDF pre-fill (S284). The operator opens this
// in a new tab from the per-tenancy rent-increase card, reviews it, completes the
// by-hand fields (landlord mailing address, signature) and Prints → Saves as PDF.
//
// Mirrors the lease print route: read-only; guarded on manage_tenancies; RLS also
// scopes every query to the caller's org. The same deriveRentIncrease() result that
// powers the card is recomputed here so the printed amounts and dates never drift
// from the card the operator clicked through from.

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

  // RLS scopes to this org; the row carries everything the N1 needs.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select(
      "id, status, rent_cents, start_date, property:properties(address), tenants(name, is_primary)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!tenancyRow) return new NextResponse("Tenancy not found", { status: 404 });

  const tenancy = tenancyRow as unknown as {
    status: string;
    rent_cents: number | null;
    start_date: string | null;
    property: { address: string } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };

  // The N1 only makes sense for an active tenancy with a known rent + start date —
  // the same gate the card uses before it renders the "Open pre-filled N1" link.
  if (
    tenancy.status !== "active" ||
    tenancy.rent_cents == null ||
    !tenancy.start_date
  ) {
    return new NextResponse(
      "A rent increase notice is only available for an active tenancy with a rent and start date set.",
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // Anchor "today" to America/Toronto so the legal date math matches the card
  // (Vercel server components run in UTC — KI443).
  const todayOntario = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });

  const result = deriveRentIncrease(
    { startDate: tenancy.start_date, currentRentCents: tenancy.rent_cents },
    todayOntario,
  );
  if (!result) {
    return new NextResponse("Could not compute the rent increase.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Primary tenant first, then co-tenants; drop the unnamed.
  const tenantNames = (tenancy.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((t) => (t.name ?? "").trim())
    .filter((n) => n.length > 0);

  const model: N1RenderModel = {
    landlordName: org.name,
    landlordPhone: org.public_contact_phone ?? null,
    landlordEmail: org.public_contact_email ?? null,
    tenantNames,
    rentalUnitAddress: tenancy.property?.address ?? null,
    currentRent: formatRentCents(result.currentRentCents),
    newRent: result.newRentCents != null ? formatRentCents(result.newRentCents) : null,
    increaseAmount:
      result.increaseCents != null ? formatRentCents(result.increaseCents) : null,
    guidelinePercent: result.guidelinePercent,
    effectiveDate: result.effectiveDate,
    serveByDate: result.serveByDate,
    exempt: result.exempt,
    generatedAtIso: new Date().toISOString(),
  };

  return new NextResponse(renderN1Html(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
