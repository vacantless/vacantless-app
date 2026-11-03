import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_ERROR_LIMIT, cleanAppError } from "@/lib/app-errors";
import { allowHit, clientIpFrom, ipKey } from "@/lib/public-submit-limit";

// S748: the error pages post here when a page crashes, so the daily health
// email can count crashes instead of saying "not checked". Open to anyone (a
// crash can happen signed out), capped per connection, and it never answers
// with anything a script could use.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const row = cleanAppError(await req.json().catch(() => null));
    if (!row) return new NextResponse(null, { status: 204 });
    const admin = createAdminClient();
    if (!admin) return new NextResponse(null, { status: 204 });
    const key = ipKey(clientIpFrom((n) => req.headers.get(n)));
    if (!(await allowHit(admin, key && `apperr:${key}`, APP_ERROR_LIMIT))) {
      return new NextResponse(null, { status: 204 });
    }
    await admin.from("app_errors").insert(row);
  } catch {
    // never fail a crash report
  }
  return new NextResponse(null, { status: 204 });
}
