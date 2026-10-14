// ============================================================================
// canonical-host (S714). One address for signed-in pages.
//
// The homepage lives on www.vacantless.com, and its Start free / Log in links
// open /signup and /login there. But Stripe, Facebook and every email send the
// landlord back to app.vacantless.com, and a login on one host is not a login
// on the other. S714's new-landlord run signed up on www, paid on Stripe, and
// came back to app signed in as a different account.
//
// So every account page (sign up, log in, onboarding, dashboard, password and
// email-link pages) answers on the app host only. Marketing pages and the
// public rental pages stay where they are. Only GET/HEAD move (form posts and
// server actions never redirect); /api never moves.
// ============================================================================

export const LEGACY_APP_HOST = "vacantless-app.vercel.app";
export const MARKETING_HOSTS = ["www.vacantless.com", "vacantless.com"] as const;

/** Paths that need the visitor's login, or create it. */
export const ACCOUNT_PATH_PREFIXES = [
  "/signup",
  "/login",
  "/onboarding",
  "/dashboard",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/account-closed",
] as const;

export function isAccountPath(pathname: string): boolean {
  return ACCOUNT_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Where to send this request, or null to serve it here.
 * - The old Vercel host: every page moves to the app host (S700).
 * - The marketing hosts: account pages move to the app host (S714).
 */
export function canonicalRedirect(input: {
  host: string;
  method: string;
  pathname: string;
  search: string;
  canonicalHost: string;
}): string | null {
  const host = input.host.toLowerCase();
  const canonical = input.canonicalHost.toLowerCase();
  if (input.method !== "GET" && input.method !== "HEAD") return null;
  if (input.pathname.startsWith("/api/")) return null;
  if (host === canonical) return null;
  const target = `https://${canonical}${input.pathname}${input.search}`;
  if (host === LEGACY_APP_HOST) return target;
  if ((MARKETING_HOSTS as readonly string[]).includes(host) && isAccountPath(input.pathname)) return target;
  return null;
}
