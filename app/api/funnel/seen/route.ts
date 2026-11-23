import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanSections, cleanVisitor, isBot } from "@/lib/stranger-funnel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// S835i: the homepage tells us each section a browser brought into view
// (components/visit-beacon.tsx). One row per browser, per section, per day.
// Same rules as /api/funnel/visit: bots and signed-in visitors are not
// counted, the browser id is the cookie that route set, and it always answers
// 204 so the page never waits on it or shows an error.
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  try {
    if (isBot(req.headers.get("user-agent"))) return res;
    const sections = cleanSections(req.nextUrl.searchParams.get("s"));
    if (!sections.length) return res;
    const visitor = cleanVisitor(req.cookies.get("vl_vid")?.value);
    if (!visitor) return res;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return res;

    const admin = createAdminClient();
    if (!admin) return res;
    await admin
      .from("funnel_sections")
      .upsert(
        sections.map((section) => ({ visitor, section })),
        { onConflict: "visited_on,visitor,section", ignoreDuplicates: true },
      );
  } catch {
    // Counting must never break a page.
  }
  return res;
}
