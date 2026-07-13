import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { fillOfficialN4 } from "@/lib/n4-official-pdf";
import { snapshotToN4Fill, n4SnapshotReady, type N4Snapshot } from "@/lib/n4-snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// Operator download of the official Form N4 PDF to review + serve themselves —
// the prepare-first path (design section 4): the operator gets the real
// Board-approved form BEFORE recording service, prints it, and serves the tenant.
// Guarded on manage_tenancies; RLS scopes the notice read to the caller's org.
// Filled from the IMMUTABLE snapshot frozen at prepare time. Works for a draft or
// served notice (the operator needs the PDF in hand to serve). ?notice=<id>.

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await currentUserCan("manage_tenancies"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const noticeId = req.nextUrl.searchParams.get("notice") ?? "";
  if (!noticeId) return new NextResponse("Not found", { status: 404 });

  const supabase = createClient();
  const { data } = await supabase
    .from("notices")
    .select("id, type, tenancy_id, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", params.id)
    .maybeSingle();

  const row = data as {
    type: string | null;
    tenancy_id: string | null;
    snapshot: N4Snapshot | null;
  } | null;
  const snap = row?.snapshot ?? null;
  if (!row || row.type !== "N4" || !snap || !n4SnapshotReady(snap)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await fillOfficialN4(snapshotToN4Fill(snap));
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'inline; filename="Form-N4-Notice-to-End-Tenancy-Non-payment.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
