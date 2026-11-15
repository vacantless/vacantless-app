// ============================================================================
// Demo account (S800). "See a live account": one visitor sign-in to the
// Lakeview Rentals test account, with every write blocked.
//
// Why this is a pure file with a test: the demo login is a REAL member of a
// REAL account, and many server actions use the service key, which skips row
// security. So read-only is enforced in one place that cannot be forgotten:
// middleware refuses every request that is not a GET or HEAD for the demo
// login (server actions, form posts and API calls are all non-GET), and only a
// short list of read pages is open. scripts/test-demo-account.ts fails if
// either rule ever loosens.
//
// The demo login is identified by DEMO_ACCOUNT_EMAIL. When that is not set the
// whole feature is off: no button, no sign-in, no special rules.
// ============================================================================

/** Lakeview Rentals, the test account the how-to videos were filmed in. */
export const DEMO_ORG_ID = "b6fdceb7-e7f6-4f54-bbab-107ae5d3254a";

export function demoEmail(env: Record<string, string | undefined>): string | null {
  const e = (env.DEMO_ACCOUNT_EMAIL ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export function isDemoEmail(
  email: string | null | undefined,
  configured: string | null | undefined,
): boolean {
  const a = (email ?? "").trim().toLowerCase();
  const b = (configured ?? "").trim().toLowerCase();
  return a !== "" && b !== "" && a === b;
}

export type DemoDecision =
  | { kind: "allow" }
  | { kind: "deny" } // 403, no page
  | { kind: "redirect"; to: string };

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** The signed-in pages the demo may open: Today, Rentals, Renters, Viewings. */
const OPEN_DASHBOARD_PAGES: readonly RegExp[] = [
  /^\/dashboard\/?$/,
  /^\/dashboard\/properties\/?$/,
  new RegExp(`^/dashboard/properties/${UUID}/?$`),
  /^\/dashboard\/leads\/?$/,
  new RegExp(`^/dashboard/leads/${UUID}/?$`),
  /^\/dashboard\/showings\/?$/,
];

/** Paths outside /dashboard that are never for the demo login. */
const CLOSED_PREFIXES = ["/onboarding", "/agent", "/admin", "/api"] as const;

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** What to do with one request from the demo login. */
export function demoDecision(input: { method: string; pathname: string }): DemoDecision {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return { kind: "deny" };

  const path = input.pathname;
  if (CLOSED_PREFIXES.some((p) => underPrefix(path, p))) {
    return path.startsWith("/api") ? { kind: "deny" } : { kind: "redirect", to: "/dashboard" };
  }
  if (underPrefix(path, "/dashboard")) {
    return OPEN_DASHBOARD_PAGES.some((re) => re.test(path))
      ? { kind: "allow" }
      : { kind: "redirect", to: "/dashboard" };
  }
  // Public pages (homepage, renter pages, sign in, sign up, /demo/exit) stay open.
  return { kind: "allow" };
}

// ---- contact masking (the demo data carries the owner's own addresses) -----

export function maskEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  if (!e) return null;
  const first = e[0] ?? "";
  return `${first}***@example.com`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "***";
}

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;

/** Free text (messages, notes): swap anything that looks like an address or a number. */
export function scrubContactText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text
    .replace(EMAIL_IN_TEXT, (m) => maskEmail(m) ?? "")
    .replace(PHONE_IN_TEXT, (m) => maskPhone(m) ?? "");
}

/** S800b: true for a browser or Next.js prefetch, which must never sign anyone out. */
export function isPrefetch(headers: { get(name: string): string | null }): boolean {
  const purpose = (headers.get("purpose") ?? headers.get("sec-purpose") ?? "").toLowerCase();
  return (
    headers.get("next-router-prefetch") != null ||
    headers.get("rsc") != null ||
    purpose.includes("prefetch")
  );
}
