import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanPage, cleanVisitor, isBot } from "@/lib/stranger-funnel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VISITOR_COOKIE = "vl_vid";

// S800 (REVIEW-S799 item 8): the homepage and sign-up page each send one beacon
// per load. Stores one row per browser, per page, per day (lib/stranger-funnel).
// Signed-in visitors are not counted: they are us or landlords already in.
// Always answers 204, so a page never waits on it or shows an error.
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  try {
    if (isBot(req.headers.get("user-agent"))) return res;
    const page = cleanPage(req.nextUrl.searchParams.get("page"));
    if (!page) return res;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return res;

    let visitor = cleanVisitor(req.cookies.get(VISITOR_COOKIE)?.value);
    if (!visitor) {
      visitor = randomUUID();
      res.cookies.set(VISITOR_COOKIE, visitor, {
        maxAge: 365 * 86_400,
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      });
    }

    const admin = createAdminClient();
    if (!admin) return res;
    await admin
      .from("funnel_visits")
      .upsert({ visitor, page }, { onConflict: "visited_on,visitor,page", ignoreDuplicates: true });
  } catch {
    // Counting must never break a page.
  }
  return res;
}
