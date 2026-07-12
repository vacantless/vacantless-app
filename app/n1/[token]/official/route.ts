import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fillOfficialN1 } from "@/lib/n1-official-pdf";
import type { N1Snapshot } from "@/lib/n1-render";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// Public download of the OFFICIAL LTB Form N1 PDF for a served notice (S469).
// Same handle + posture as the sibling /n1/[token] HTML view: the tenant opens
// it from the served email; the per-tenancy n1_service_token is the only key.
// Built strictly from the IMMUTABLE n1_snapshot (never re-derived), so the PDF
// matches the notice that was served. Requires a served snapshot with a real
// new-rent amount — otherwise 404 (an unserved default token yields nothing).

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Not found", { status: 404 });

  const { data } = await admin
    .from("tenancies")
    .select("n1_served_at, n1_snapshot")
    .eq("n1_service_token", params.token)
    .maybeSingle();

  const row = data as { n1_served_at: string | null; n1_snapshot: N1Snapshot | null } | null;
  const snap = row?.n1_snapshot ?? null;
  // Only a served notice with a computed amount produces the official form.
  if (!row || !row.n1_served_at || !snap || snap.newRentCents == null) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await fillOfficialN1(snap);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N1-Notice-of-Rent-Increase.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
