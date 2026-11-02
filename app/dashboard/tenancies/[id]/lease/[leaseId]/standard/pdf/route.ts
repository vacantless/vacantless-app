import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import { loadStandardLease } from "@/lib/standard-lease-server";
import { fillStandardLease } from "@/lib/standard-lease-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// S743: Ontario's Standard Form of Lease (2229E) for one lease document, filled
// from the tenancy plus the details saved on the standard page, with the
// additional terms (clauses) attached. Guarded like the HTML lease view.
export async function GET(req: NextRequest, { params }: { params: { id: string; leaseId: string } }) {
  if (await postLeaseRouteWalled()) return new Response("Not found", { status: 404 });
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));
  if (!(await currentUserCan("manage_tenancies"))) return new NextResponse("Forbidden", { status: 403 });

  const loaded = await loadStandardLease(createClient(), {
    tenancyId: params.id, leaseId: params.leaseId, orgId: org.id, orgName: org.name,
  });
  if (!loaded) return new NextResponse("Lease not found", { status: 404 });

  const bytes = await fillStandardLease({ ...loaded.input, additionalTerms: loaded.additionalTerms });
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Ontario-Standard-Lease-2229E.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
