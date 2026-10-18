import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

import { canonicalRedirect } from "@/lib/canonical-host";
import {
  SOURCE_COOKIE,
  SOURCE_COOKIE_DAYS,
  captureSource,
  cookieDomainFor,
  encodeSourceCookie,
} from "@/lib/signup-source";

// S700 (dress rehearsal F1): the app answered on two hosts with two separate
// logins, so one browser could be signed in to two different orgs at once.
// Page visits to the old Vercel host move to the real address.
// S714: account pages on www.vacantless.com / vacantless.com move too, so a
// landlord who signs up from the homepage is still signed in when Stripe,
// Facebook or an email link brings them back to app.vacantless.com.
// Only GET/HEAD, never /api (lib/canonical-host.ts).
const CANONICAL_APP_HOST =
  process.env.CANONICAL_APP_HOST?.trim() || "app.vacantless.com";

export async function middleware(request: NextRequest) {
  const target = canonicalRedirect({
    host: request.headers.get("host") ?? "",
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    canonicalHost: CANONICAL_APP_HOST,
  });
  if (target) return NextResponse.redirect(target, 308);
  const response = await updateSession(request);
  rememberFirstTouch(request, response);
  return response;
}

// S723: first-touch ad source for page visits (lib/signup-source.ts). Kept only
// when the visit has ad tags or an outside referrer, and never overwritten.
function rememberFirstTouch(request: NextRequest, response: NextResponse) {
  try {
    if (request.method !== "GET") return;
    const path = request.nextUrl.pathname;
    if (path.startsWith("/api")) return;
    if (request.cookies.get(SOURCE_COOKIE)) return;
    const src = captureSource({
      searchParams: request.nextUrl.searchParams,
      referer: request.headers.get("referer"),
      path,
      now: new Date(),
    });
    if (!src) return;
    response.cookies.set(SOURCE_COOKIE, encodeSourceCookie(src), {
      maxAge: SOURCE_COOKIE_DAYS * 86_400,
      path: "/",
      sameSite: "lax",
      secure: true,
      httpOnly: true,
      domain: cookieDomainFor(request.headers.get("host")),
    });
  } catch {
    // Never let attribution break a page.
  }
}

export const config = {
  matcher: [
    // Run on everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
