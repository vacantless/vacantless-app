import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// S700 (dress rehearsal F1): the app answered on two hosts with two separate
// logins, so one browser could be signed in to two different orgs at once.
// Page visits to the old Vercel host now move to the real address. Only the
// exact old host is moved (preview deployments keep their own URLs), only
// GET/HEAD (form posts and server actions are never redirected), and never
// /api (the GitHub cron workflows and webhooks call the old host directly).
const LEGACY_APP_HOST = "vacantless-app.vercel.app";
const CANONICAL_APP_HOST =
  process.env.CANONICAL_APP_HOST?.trim() || "app.vacantless.com";

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;
  if (
    host === LEGACY_APP_HOST &&
    CANONICAL_APP_HOST !== LEGACY_APP_HOST &&
    (request.method === "GET" || request.method === "HEAD") &&
    !pathname.startsWith("/api/")
  ) {
    const target = new URL(
      `${pathname}${request.nextUrl.search}`,
      `https://${CANONICAL_APP_HOST}`,
    );
    return NextResponse.redirect(target, 308);
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
