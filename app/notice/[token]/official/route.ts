import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fillOfficialN4 } from "@/lib/n4-official-pdf";
import { snapshotToN4Fill, n4SnapshotReady, type N4Snapshot } from "@/lib/n4-snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// Public download of the OFFICIAL LTB Form N4 PDF for a served notice (Slice C).
// Same handle + posture as the sibling /notice/[token] HTML summary: the tenant
// opens it from the notice they were served; the per-notice service_token is the
// only key. Built strictly from the IMMUTABLE snapshot (never re-derived), so the
// PDF matches what was served. Requires a served, reconciling snapshot — else 404.

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Not found", { status: 404 });

  const { data } = await admin
    .from("notices")
    .select("type, status, snapshot, served_at")
    .eq("service_token", params.token)
    .maybeSingle();

  const row = data as {
    type: string | null;
    status: string | null;
    snapshot: N4Snapshot | null;
    served_at: string | null;
  } | null;

  const snap = row?.snapshot ?? null;
  const isServed =
    !!row && (row.status === "served" || row.status === "filed") && !!row.served_at;
  if (!row || row.type !== "N4" || !isServed || !snap || !n4SnapshotReady(snap)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
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
  } catch {
    return new NextResponse("This notice could not be generated.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
