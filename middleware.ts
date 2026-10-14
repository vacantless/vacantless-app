import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

import { canonicalRedirect } from "@/lib/canonical-host";

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
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
