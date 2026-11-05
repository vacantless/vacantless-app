import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { fillOfficialN6 } from "@/lib/n6-official-pdf";
import type { N6Snapshot } from "../../../n6-actions";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S751: download the official Form N6 (2026/09) filled from the frozen snapshot.
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
  const row = data as { type: string | null; snapshot: N6Snapshot | null } | null;
  if (!row || row.type !== "N6" || !row.snapshot?.terminationDateISO) {
    return new NextResponse("Not found", { status: 404 });
  }
  const bytes = await fillOfficialN6(row.snapshot);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N6-Notice-Illegal-Act-or-Income.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
