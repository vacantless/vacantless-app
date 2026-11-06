import { NextRequest, NextResponse } from "next/server";
import { fillOfficialN8 } from "@/lib/n8-official-pdf";
import { computeN8Tool, n8ToolFill, parseN8Params } from "@/lib/n8-tool";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S757: the free tool's filled official LTB Form N8 (2026/09), Reason 1
// (persistent late rent). Same fill as the in-app N8, recomputed on the server.
// Refused until 3 countable late payments and a valid date.

export async function GET(req: NextRequest) {
  const parsed = parseN8Params(req.nextUrl.searchParams);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const out = computeN8Tool(parsed.input, today);
  if (!out.ok) return new NextResponse(out.error, { status: 400 });
  if (out.result.problems.length > 0) {
    return new NextResponse(out.result.problems.map((p) => p.text).join("\n"), { status: 400 });
  }
  let bytes: Uint8Array;
  try {
    bytes = await fillOfficialN8(n8ToolFill(parsed.input, out.result));
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "The form could not be filled.", { status: 400 });
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-N8-Persistent-Late-Payment.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
