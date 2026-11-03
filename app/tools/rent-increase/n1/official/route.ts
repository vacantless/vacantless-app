import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGuidelineLookup } from "@/lib/guideline-server";
import { guidelineForYear } from "@/lib/rent-increase";
import { fillOfficialN1 } from "@/lib/n1-official-pdf";
import { computeTool, parseToolParams, toolSnapshot } from "@/lib/rent-increase-tool";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S746: the free tool's filled official LTB Form N1. Same fill as the served
// notice (lib/n1-official-pdf.ts), built from a snapshot recomputed on the server.

export async function GET(req: NextRequest) {
  const parsed = parseToolParams(req.nextUrl.searchParams);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });

  const admin = createAdminClient();
  const guideline = admin ? await loadGuidelineLookup(admin) : guidelineForYear;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const result = computeTool(parsed.input, today, guideline);
  if (!result || result.newRentCents == null) {
    return new NextResponse("The new rent could not be worked out from these inputs.", { status: 400 });
  }

  const snap = toolSnapshot(parsed.input, result, new Date().toISOString());
  let bytes: Uint8Array;
  try {
    bytes = await fillOfficialN1(snap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The form could not be filled.";
    return new NextResponse(msg, { status: 400 });
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N1-Notice-of-Rent-Increase.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
