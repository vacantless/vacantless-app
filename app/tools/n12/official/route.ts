import { NextRequest, NextResponse } from "next/server";
import { fillOfficialN12 } from "@/lib/n12-official-pdf";
import { computeN12Tool, n12ToolFill, parseN12Params } from "@/lib/n12-tool";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S757: the free tool's filled official LTB Form N12 (2026/10). Same fill as the
// in-app N12 (lib/n12-official-pdf.ts), from a result recomputed on the server
// from the query. Refused while any problem would make the notice invalid.

export async function GET(req: NextRequest) {
  const parsed = parseN12Params(req.nextUrl.searchParams);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const out = computeN12Tool(parsed.input, today);
  if (!out.ok) return new NextResponse(out.error, { status: 400 });
  if (out.result.problems.length > 0) {
    return new NextResponse(out.result.problems.map((p) => p.text).join("\n"), { status: 400 });
  }
  let bytes: Uint8Array;
  try {
    bytes = await fillOfficialN12(n12ToolFill(out.result));
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "The form could not be filled.", { status: 400 });
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N12-Landlord-or-Purchaser-Requires-Unit.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
