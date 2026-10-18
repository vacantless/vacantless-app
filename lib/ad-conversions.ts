// ad-conversions.ts (S723). Google Ads and Meta tags for paid landlord ads.
//
// OFF until Noam adds the ad account IDs in Vercel (env below) and redeploys.
// With none set, no tag loads anywhere, nothing is sent, and the privacy page
// keeps saying we use no advertising cookies (app/privacy/page.tsx reads
// adTagsOn too). Tags load only on our own marketing and sign-up pages, never
// on renter pages (/r, /showing, /f) or tenant-branded pages. Two conversions:
//   signup      - an account was created (fires on its first dashboard visit)
//   first_live  - the account's first rental went live (the one that matters)
// Each fires once per account, recorded in organizations.ad_conversions.
// Pure helpers; tested in scripts/test-ad-conversions.ts.

export const AD_ENV = {
  googleId: "GOOGLE_ADS_ID", // AW-123456789
  signupLabel: "GOOGLE_ADS_SIGNUP_LABEL",
  liveLabel: "GOOGLE_ADS_LIVE_LABEL",
  metaPixelId: "META_PIXEL_ID", // digits
} as const;

export type AdTagConfig = {
  googleId: string | null;
  signupLabel: string | null;
  liveLabel: string | null;
  metaPixelId: string | null;
};

export type ConversionEvent = "signup" | "first_live";
export const CONVERSION_EVENTS: readonly ConversionEvent[] = ["signup", "first_live"];

// Accounts created before this never fire (turning tags on later must not
// report every old account as a new conversion).
export const TRACKING_START = "2026-10-19T00:00:00Z";
const SIGNUP_WINDOW_DAYS = 30;
const LIVE_WINDOW_DAYS = 90;

function pick(v: string | undefined, re: RegExp): string | null {
  const s = (v ?? "").trim();
  return re.test(s) ? s : null;
}

export function adTagConfig(env: Record<string, string | undefined>): AdTagConfig {
  return {
    googleId: pick(env[AD_ENV.googleId], /^AW-\d{5,15}$/),
    signupLabel: pick(env[AD_ENV.signupLabel], /^[A-Za-z0-9_-]{3,40}$/),
    liveLabel: pick(env[AD_ENV.liveLabel], /^[A-Za-z0-9_-]{3,40}$/),
    metaPixelId: pick(env[AD_ENV.metaPixelId], /^\d{6,20}$/),
  };
}

export function adTagsOn(cfg: AdTagConfig): boolean {
  return !!(cfg.googleId || cfg.metaPixelId);
}

const MARKETING_EXACT = new Set(["/", "/about", "/realtors", "/signup", "/terms", "/privacy"]);

/** Our own marketing and sign-up pages. Renter and tenant pages are never tagged. */
export function isMarketingPath(path: string | null | undefined): boolean {
  const p = (path ?? "").split("?")[0].replace(/\/+$/, "") || "/";
  if (MARKETING_EXACT.has(p)) return true;
  return p === "/compare" || p.startsWith("/compare/");
}

export function sentMap(v: unknown): Partial<Record<ConversionEvent, string>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Record<ConversionEvent, string>> = {};
  for (const k of CONVERSION_EVENTS) if (typeof o[k] === "string") out[k] = o[k] as string;
  return out;
}

/** Which conversions this account should report now. */
export function conversionsToFire(input: {
  createdAt: string | null | undefined;
  sent: unknown;
  hasLiveRental: boolean;
  isOwnTest: boolean;
  now: Date;
}): ConversionEvent[] {
  if (input.isOwnTest || !input.createdAt) return [];
  const created = Date.parse(input.createdAt);
  if (Number.isNaN(created) || created < Date.parse(TRACKING_START)) return [];
  const ageDays = (input.now.getTime() - created) / 86_400_000;
  const sent = sentMap(input.sent);
  const out: ConversionEvent[] = [];
  if (!sent.signup && ageDays <= SIGNUP_WINDOW_DAYS) out.push("signup");
  if (input.hasLiveRental && !sent.first_live && ageDays <= LIVE_WINDOW_DAYS) out.push("first_live");
  return out;
}

/** Merge newly sent events into the stored map; never overwrite a time already set. */
export function markSent(
  prev: unknown,
  events: readonly string[],
  now: Date,
): Partial<Record<ConversionEvent, string>> {
  const out = sentMap(prev);
  for (const e of events) {
    if ((CONVERSION_EVENTS as readonly string[]).includes(e) && !out[e as ConversionEvent]) {
      out[e as ConversionEvent] = now.toISOString();
    }
  }
  return out;
}
