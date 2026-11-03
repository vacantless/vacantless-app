import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGuidelineLookup } from "@/lib/guideline-server";
import { guidelineForYear } from "@/lib/rent-increase";
import { n1ModelFromSnapshot, renderN1Html } from "@/lib/n1-render";
import { computeTool, parseToolParams, toolSnapshot } from "@/lib/rent-increase-tool";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// S746: the free tool's printable review copy of Form N1. No sign-in, nothing
// stored. The numbers are recomputed here from the query, never trusted from the
// page, so the printed form always matches the engine.

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
  const html = renderN1Html(n1ModelFromSnapshot(snap));
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
