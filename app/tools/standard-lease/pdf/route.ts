import { NextRequest, NextResponse } from "next/server";
import { fillStandardLease } from "@/lib/standard-lease-pdf";
import { leaseToolFromForm, problemsPage } from "@/lib/standard-lease-tool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// S746c: the free tool's filled Ontario Standard Form of Lease (2229E). A plain
// form POST; nothing is stored. Same fill as the signed-in lease, no signatures.

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse("Send the form from the page.", { status: 400 });
  }
  const get = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : null;
  };
  const tool = leaseToolFromForm(get);
  if (tool.problems.length) {
    return new NextResponse(problemsPage(tool.problems), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = await fillStandardLease({ ...tool.input, additionalTerms: tool.additionalTerms, signatures: [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The form could not be filled.";
    return new NextResponse(msg, { status: 400 });
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Ontario-Standard-Lease-2229E.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
