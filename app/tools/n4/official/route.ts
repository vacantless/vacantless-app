import { NextRequest, NextResponse } from "next/server";
import { fillOfficialN4 } from "@/lib/n4-official-pdf";
import { computeN4Tool, n4FormReady, n4ToolSnapshot, parseN4Params } from "@/lib/n4-tool";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S755: the free tool's filled official LTB Form N4 (2026/09). Same fill as the
// in-app N4 (lib/n4-official-pdf.ts), built from a result recomputed on the
// server from the query, so the page can't be talked into a different number.

export async function GET(req: NextRequest) {
  const parsed = parseN4Params(req.nextUrl.searchParams);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });
  if (!n4FormReady(parsed.input)) {
    return new NextResponse("Enter the landlord name, the tenant names and the rental address.", { status: 400 });
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const out = computeN4Tool(parsed.input, today);
  if (!out.ok) return new NextResponse(out.error, { status: 400 });

  let bytes: Uint8Array;
  try {
    bytes = await fillOfficialN4(n4ToolSnapshot(parsed.input, out.result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The form could not be filled.";
    return new NextResponse(msg, { status: 400 });
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N4-Notice-Non-payment-of-Rent.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
