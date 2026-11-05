import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { fillOfficialN13 } from "@/lib/n13-official-pdf";
import { snapshotToN13Fill, type N13Snapshot } from "@/lib/n13-snapshot";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S751: download the official Form N13 (2026/09) filled from the frozen snapshot,
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
    .select("id, type, tenancy_id, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  const row = data as { type: string | null; snapshot: N13Snapshot | null } | null;
  if (!row || row.type !== "N13" || !row.snapshot?.terminationDateISO) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await fillOfficialN13(snapshotToN13Fill(row.snapshot));
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N13-Notice-Demolish-Repair-Convert.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
