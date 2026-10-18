// signup-source.ts (S723). Where a new account came from.
//
// Noam is about to run Google and Meta ads. Before S723 a sign-up recorded
// only a referral link, so ad money could not be judged. The first time a
// browser arrives with ad tags (utm_*, gclid, fbclid) or from another site,
// middleware stores a small first-touch cookie for 90 days. Sign-up (or the
// later onboarding step, after an email confirm) copies it onto the new
// organization as signup_source, and the daily New accounts email shows it.
// Everything here is pure so it can be unit tested (scripts/test-signup-source.ts).

export const SOURCE_COOKIE = "vl_src";
export const SOURCE_COOKIE_DAYS = 90;
const MAX_LEN = 80;

export type SignupSource = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  gclid?: boolean;
  fbclid?: boolean;
  referrer?: string; // host only, never a full URL
  landing?: string; // path only, never the query string
  at: string; // ISO time of first touch
};

const OWN_HOST_SUFFIXES = ["vacantless.com", "vercel.app", "localhost"];

function clean(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const s = String(v)
    .replace(/[^\w .:/+@-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEN);
  return s || undefined;
}

/** Host of an outside referrer, or undefined for our own site, blanks and junk. */
export function referrerHost(referer: string | null | undefined): string | undefined {
  if (!referer) return undefined;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  host = host.replace(/^www\./, "");
  if (!host) return undefined;
  if (OWN_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s))) return undefined;
  return clean(host);
}

/**
 * The first-touch record for one page visit, or null when the visit carries no
 * ad tags and no outside referrer (a direct or internal visit records nothing).
 */
export function captureSource(input: {
  searchParams: URLSearchParams;
  referer: string | null | undefined;
  path: string;
  now: Date;
}): SignupSource | null {
  const q = input.searchParams;
  const src: SignupSource = { at: input.now.toISOString() };
  const source = clean(q.get("utm_source"));
  const medium = clean(q.get("utm_medium"));
  const campaign = clean(q.get("utm_campaign"));
  const term = clean(q.get("utm_term"));
  const content = clean(q.get("utm_content"));
  if (source) src.source = source;
  if (medium) src.medium = medium;
  if (campaign) src.campaign = campaign;
  if (term) src.term = term;
  if (content) src.content = content;
  if (q.get("gclid") || q.get("gbraid") || q.get("wbraid")) src.gclid = true;
  if (q.get("fbclid")) src.fbclid = true;
  const ref = referrerHost(input.referer);
  if (ref) src.referrer = ref;
  const tagged = !!(source || medium || campaign || term || content || src.gclid || src.fbclid);
  if (!tagged && !ref) return null;
  const landing = clean(input.path.split("?")[0]);
  if (landing) src.landing = landing;
  return src;
}

export function encodeSourceCookie(src: SignupSource): string {
  return encodeURIComponent(JSON.stringify(src));
}

/** Parse the cookie back. Anything malformed or tampered becomes null; values are re-cleaned. */
export function parseSourceCookie(raw: string | null | undefined): SignupSource | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : null;
  if (!at) return null;
  const out: SignupSource = { at };
  for (const k of ["source", "medium", "campaign", "term", "content", "referrer", "landing"] as const) {
    const v = typeof o[k] === "string" ? clean(o[k] as string) : undefined;
    if (v) out[k] = v;
  }
  if (o.gclid === true) out.gclid = true;
  if (o.fbclid === true) out.fbclid = true;
  return out;
}

/** Share the cookie between www.vacantless.com (home page) and app.vacantless.com (sign-up). */
/** Read the stored organizations.signup_source value with the same checks as the cookie. */
export function parseSourceValue(v: unknown): SignupSource | null {
  if (!v || typeof v !== "object") return null;
  try {
    return parseSourceCookie(encodeURIComponent(JSON.stringify(v)));
  } catch {
    return null;
  }
}

export function cookieDomainFor(host: string | null | undefined): string | undefined {
  const h = (host ?? "").toLowerCase().split(":")[0];
  if (h === "vacantless.com" || h.endsWith(".vacantless.com")) return ".vacantless.com";
  return undefined;
}

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid_social", "paid-social", "ads", "ad", "display"]);
const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta"]);

function detail(src: SignupSource): string {
  const parts: string[] = [];
  if (src.campaign) parts.push(`campaign ${src.campaign}`);
  if (src.term) parts.push(`keyword ${src.term}`);
  if (src.content) parts.push(`ad ${src.content}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** One plain line for the New accounts email. */
export function describeSource(src: SignupSource | null | undefined): string {
  if (!src) return "No source recorded";
  const source = (src.source ?? "").toLowerCase();
  const medium = (src.medium ?? "").toLowerCase();
  const paid = PAID_MEDIUMS.has(medium);
  if (src.gclid || (source === "google" && paid)) return `Google ads${detail(src)}`;
  if (src.fbclid && !source) return `Facebook or Instagram${detail(src)}`;
  if (META_SOURCES.has(source)) return `${paid ? "Facebook or Instagram ads" : "Facebook or Instagram"}${detail(src)}`;
  if (src.source) return `${src.source}${src.medium ? ` / ${src.medium}` : ""}${detail(src)}`;
  if (src.referrer) return `Link from ${src.referrer}`;
  return "No source recorded";
}
