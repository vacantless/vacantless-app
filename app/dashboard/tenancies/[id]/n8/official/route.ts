import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { fillOfficialN8 } from "@/lib/n8-official-pdf";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import type { N8Snapshot } from "@/app/dashboard/tenancies/n8-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S749: download the official Form N8 (2026/09) filled from the frozen snapshot,
// for the landlord to sign and serve themselves. manage_tenancies only; RLS
// scopes the notice to the caller's org. ?notice=<id>.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (await postLeaseRouteWalled()) return new Response("Not found", { status: 404 });
  if (!(await currentUserCan("manage_tenancies"))) return new NextResponse("Forbidden", { status: 403 });
  const noticeId = req.nextUrl.searchParams.get("notice") ?? "";
  if (!noticeId) return new NextResponse("Not found", { status: 404 });

  const supabase = createClient();
  const { data } = await supabase
    .from("notices")
    .select("id, type, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  const row = data as { type: string | null; snapshot: N8Snapshot | null } | null;
  if (!row || row.type !== "N8" || !row.snapshot?.terminationDateISO) {
    return new NextResponse("Not found", { status: 404 });
  }

  const s = row.snapshot;
  const bytes = await fillOfficialN8({
    tenantNames: s.tenantNames,
    landlordName: s.landlordName,
    rentalUnitAddress: s.rentalUnitAddress,
    terminationDateISO: s.terminationDateISO,
    details: s.details,
    signer: s.signer,
  });
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N8-Notice-Persistent-Late-Rent.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
