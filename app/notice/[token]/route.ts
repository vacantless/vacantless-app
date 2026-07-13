import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderN4Html, n4ModelFromSnapshot } from "@/lib/n4-render";
import type { N4Snapshot } from "@/lib/n4-snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Public, view-only Form N4 SUMMARY for the TENANT (N-form library Slice C).
// Same posture as the N1 lane's /n1/[token]: the tenant has no session — the
// per-notice service_token (migration 0140) is the only handle, read by the
// service-role admin client and scoped strictly to that one notice row. Renders
// the IMMUTABLE notices.snapshot frozen at prepare/serve time, so the served
// copy can never drift. Only a SERVED (or filed) N4 with a populated snapshot
// surfaces — a draft/void notice (or a wrong token) reveals nothing (404).

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
  // Only a served N4 with a real frozen snapshot renders.
  if (
    !row ||
    row.type !== "N4" ||
    !isServed ||
    !snap ||
    !Array.isArray(snap.arrearsRows) ||
    !snap.terminationDateISO
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const model = n4ModelFromSnapshot(snap, {
    officialPdfUrl: `/notice/${params.token}/official`,
  });
  return new NextResponse(renderN4Html(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
