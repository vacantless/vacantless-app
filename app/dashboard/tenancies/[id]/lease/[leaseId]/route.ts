import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { formatRentCents } from "@/lib/tenancy";
import { renderLeaseDocumentHtml, type LeaseRenderModel } from "@/lib/lease-render";

export const dynamic = "force-dynamic";

// Render a generated lease draft as a standalone, print-optimized HTML document
// (lease vault #11, slice 3 — render-before-sign). The operator opens this in a
// new tab and Prints → Save as PDF. Read-only; guarded on manage_tenancies; RLS
// also scopes every query to the caller's org. The structured header fields
// (parties / rent / term) are read from the LIVE tenancy here — faithful for a
// draft; freezing them onto the row at generation is a later slice (needs a
// small additive migration), noted in VACANTLESS-11-ESIGN-RAIL-SPIKE §1.

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; leaseId: string } },
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!(await currentUserCan("manage_tenancies"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = createClient();

  // The lease draft (RLS scopes to this org; the tenancy_id check ties it to the
  // tenancy in the URL so a mismatched pair 404s rather than rendering).
  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select("id, tenancy_id, title, status, assembled_body, created_at")
    .eq("id", params.leaseId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  if (!leaseRow) return new NextResponse("Lease not found", { status: 404 });
  const lease = leaseRow as unknown as {
    id: string;
    tenancy_id: string;
    title: string;
    status: string;
    assembled_body: string | null;
    created_at: string;
  };

  // The tenancy supplies the structured header (premises / parties / economics).
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, deposit_cents, start_date, end_date, term_months, property:properties(address), tenants(name, is_primary)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!tenancyRow) return new NextResponse("Tenancy not found", { status: 404 });
  const tenancy = tenancyRow as unknown as {
    rent_cents: number | null;
    deposit_cents: number | null;
    start_date: string | null;
    end_date: string | null;
    term_months: number | null;
    property: { address: string } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };

  // Primary tenant first, then co-tenants; drop the unnamed.
  const tenantNames = (tenancy.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((t) => (t.name ?? "").trim())
    .filter((n) => n.length > 0);

  const model: LeaseRenderModel = {
    title: lease.title,
    status: lease.status,
    generatedAtIso: lease.created_at,
    landlordName: org.name,
    propertyAddress: tenancy.property?.address ?? null,
    tenantNames,
    rent: tenancy.rent_cents != null ? formatRentCents(tenancy.rent_cents) : null,
    deposit: tenancy.deposit_cents != null ? formatRentCents(tenancy.deposit_cents) : null,
    startDate: tenancy.start_date,
    endDate: tenancy.end_date,
    termMonths: tenancy.term_months,
    clauseBody: lease.assembled_body ?? "",
  };

  return new NextResponse(renderLeaseDocumentHtml(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
