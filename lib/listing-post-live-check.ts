// Listing-post live check (S693): is a `live` listing_posts row still an ad?
//
// Pure layer. Nothing here fetches, reads the database or writes. The cron
// route (app/api/cron/listing-post-live-check) fetches each row's public URL,
// hands the raw facts to classifyListingPostLiveCheck() and writes ONLY the
// `removed` verdict back through liveCheckRowPatch().
//
// Why this exists (KI1200): a hand-posted row (S685 Manning on Kijiji, the
// Zumper and Rentals.ca rows the worker or Noam posted) has no run item and no
// checker; when the portal removes the ad the row keeps saying `live` until a
// human notices (found live on 506 Manning 2026-09-07, Kijiji ad 1743093990).
//
// Classification rule (standing rules 157/158 family): decide from the END url
// first, then the HTTP status, then the page text; when none of the measured
// signals is present the verdict is `unknown` and the row is left alone. A
// bot wall (Cloudflare "Just a moment", Zumper "Client Challenge") is
// `challenge`, never `removed`. Only `removed` is ever written.
//
// Every signal below was measured on 2026-09-07 against real pages:
//   Kijiji removed  -> 200 after ONE redirect to the category search page with
//                      `adRemoved=<ad id>` in the query
//                      (kijiji.ca/b-apartments-condos/city-of-toronto/c37l1700273?...&adRemoved=1743093990)
//   Kijiji live     -> 200, no redirect, end url still `/v-.../<ad id>`
//   Zumper removed  -> 200 on `/listings/<id>/<slug>`, text carries
//                      "Alert me when this rental is available." + "Notify me",
//                      MONTHLY RENT renders "-" (the <title> still names a price;
//                      never trust the title)
//   Zumper live     -> 200 on `/listings/<id>/<slug>`, text carries
//                      "Check availability" / "Request tour", no Notify me
//   Zumper (plain fetch from a datacentre) -> 200 with <title>Client Challenge
//   Rentals.ca removed -> redirect to the bare city search page
//                      (rentals.ca/windsor-on/833-pillette-road-6 -> rentals.ca/windsor-on)
//   Rentals.ca live -> 200 on the same path, ld+json / "Contact Property"
//   Rentals.ca unknown slug -> 200 on the same path with "Missed Shot! Oops! We
//                      couldn't find the page" (NOT the removed signal; unknown)
//   Rentals.ca (plain fetch from a datacentre) -> 403 <title>Just a moment...
//
// Zumper rows store the manage URL (zumper.com/manage/properties/listing/<id>),
// which is login-walled; the public page is zumper.com/listings/<id>. The
// target URL is derived here so the row's url is never rewritten.

export const LIVE_CHECK_PORTALS = ["kijiji", "zumper", "rentals_ca"] as const;
export type LiveCheckPortal = (typeof LIVE_CHECK_PORTALS)[number];

export function isLiveCheckPortal(value: unknown): value is LiveCheckPortal {
  return (
    typeof value === "string" &&
    (LIVE_CHECK_PORTALS as readonly string[]).includes(value)
  );
}

export const LIVE_CHECK_VERDICTS = [
  "live",
  "removed",
  "challenge",
  "needs_login",
  "unreachable",
  "unknown",
  "unsupported",
] as const;
export type LiveCheckVerdict = (typeof LIVE_CHECK_VERDICTS)[number];

/** The only verdict the route may write. Everything else is report-only. */
export const LIVE_CHECK_WRITABLE_VERDICTS: readonly LiveCheckVerdict[] = [
  "removed",
];

export type LiveCheckTarget = {
  portal: LiveCheckPortal;
  /** The URL to fetch (public page; derived for Zumper). */
  url: string;
  /** Portal-side listing / ad id when the URL carries one. */
  externalId: string | null;
};

export type LiveCheckFacts = {
  portal: string;
  /** The URL that was fetched (LiveCheckTarget.url). */
  requestedUrl: string;
  /** Where the fetch ended after redirects; null when the fetch threw. */
  endUrl: string | null;
  httpStatus: number | null;
  /** Response body (HTML or text), possibly truncated; null when unavailable. */
  bodyText: string | null;
  /** Transport error message when the fetch threw (timeout, DNS, TLS). */
  fetchError?: string | null;
};

export type LiveCheckOutcome = {
  verdict: LiveCheckVerdict;
  /** Stable machine reason (snake_case), one per branch below. */
  reason: string;
  /** Human evidence for the row note; null when nothing worth quoting. */
  evidence: string | null;
};

// --- target derivation -------------------------------------------------------

function parseUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

function hostIs(u: URL, host: string): boolean {
  const h = u.hostname.toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}

const KIJIJI_AD_ID_RE = /\/(\d{6,})\/?$/;
const ZUMPER_ID_RE = /\/(?:listings|manage\/properties\/listing)\/(\d{5,})(?:[/?#]|$)/;
const RENTALS_CA_ID_RE = /-id(\d{5,})\/?$/;

/**
 * Where to look for this row. Returns null when the portal is not checkable
 * or the URL does not carry the shape the check depends on.
 */
export function listingPostLiveCheckTarget(
  portal: unknown,
  url: string | null | undefined,
): LiveCheckTarget | null {
  if (!isLiveCheckPortal(portal)) return null;
  const u = parseUrl(url);
  if (!u) return null;

  if (portal === "kijiji") {
    if (!hostIs(u, "kijiji.ca")) return null;
    if (!u.pathname.startsWith("/v-")) return null;
    const m = u.pathname.match(KIJIJI_AD_ID_RE);
    if (!m) return null;
    return {
      portal,
      url: `${u.origin}${u.pathname}`,
      externalId: m[1],
    };
  }

  if (portal === "zumper") {
    if (!hostIs(u, "zumper.com")) return null;
    const m = u.pathname.match(ZUMPER_ID_RE);
    if (!m) return null;
    return {
      portal,
      url: `https://www.zumper.com/listings/${m[1]}`,
      externalId: m[1],
    };
  }

  // rentals_ca
  if (!hostIs(u, "rentals.ca")) return null;
  const segments = u.pathname.split("/").filter(Boolean);
  // A public listing page is exactly /<city>/<slug>; /manage/... is the
  // landlord console and is login-walled.
  if (segments.length !== 2 || segments[0] === "manage") return null;
  const idMatch = segments[1].match(RENTALS_CA_ID_RE);
  return {
    portal,
    url: `${u.origin}/${segments[0]}/${segments[1]}`,
    externalId: idMatch ? idMatch[1] : null,
  };
}

// --- classification ----------------------------------------------------------

const CHALLENGE_TITLE_RE =
  /<title>\s*(Just a moment|Client Challenge|Attention Required|Access Denied)/i;
const CHALLENGE_BODY_RE = /__cf_chl|cf-browser-verification|cf_chl_opt/i;

function pathOf(raw: string | null): string | null {
  const u = parseUrl(raw);
  return u ? u.pathname.replace(/\/+$/, "") : null;
}

function isChallenge(f: LiveCheckFacts): LiveCheckOutcome | null {
  const body = f.bodyText ?? "";
  if (CHALLENGE_TITLE_RE.test(body) || CHALLENGE_BODY_RE.test(body)) {
    return {
      verdict: "challenge",
      reason: "bot_wall_page",
      evidence: `HTTP ${f.httpStatus ?? "?"}, bot-wall page at ${f.endUrl ?? f.requestedUrl}`,
    };
  }
  if (f.httpStatus === 403 || f.httpStatus === 429 || f.httpStatus === 503) {
    return {
      verdict: "challenge",
      reason: `http_${f.httpStatus}`,
      evidence: `HTTP ${f.httpStatus} at ${f.endUrl ?? f.requestedUrl}`,
    };
  }
  return null;
}

function classifyKijiji(f: LiveCheckFacts, adId: string | null): LiveCheckOutcome {
  const end = parseUrl(f.endUrl);
  if (!end) return { verdict: "unknown", reason: "no_end_url", evidence: null };

  if (end.pathname.startsWith("/t-login")) {
    return { verdict: "needs_login", reason: "login_redirect", evidence: end.href };
  }

  const removedId = end.searchParams.get("adRemoved");
  if (removedId) {
    if (adId && removedId === adId && f.httpStatus === 200) {
      return {
        verdict: "removed",
        reason: "kijiji_ad_removed_redirect",
        evidence: `Kijiji redirected ad ${adId} to the search page with adRemoved=${removedId}`,
      };
    }
    if (adId && removedId === adId) {
      // The measured signal is adRemoved on a 200 landing; any other status
      // on that redirect is unmeasured.
      return {
        verdict: "unknown",
        reason: `kijiji_ad_removed_http_${f.httpStatus ?? "none"}`,
        evidence: end.href,
      };
    }
    return {
      verdict: "unknown",
      reason: "kijiji_ad_removed_other_id",
      evidence: `adRemoved=${removedId} but the row's ad id is ${adId ?? "unknown"}`,
    };
  }

  const endPath = end.pathname.replace(/\/+$/, "");
  const reqPath = pathOf(f.requestedUrl);
  if (
    f.httpStatus === 200 &&
    endPath.startsWith("/v-") &&
    adId &&
    endPath.endsWith(`/${adId}`)
  ) {
    return {
      verdict: "live",
      reason: "kijiji_ad_page_200",
      evidence: `HTTP 200 on ${endPath === reqPath ? "the ad url" : end.href}`,
    };
  }

  if (endPath.startsWith("/b-")) {
    return {
      verdict: "unknown",
      reason: "kijiji_search_redirect_without_ad_removed",
      evidence: end.href,
    };
  }
  return {
    verdict: "unknown",
    reason: `kijiji_unmatched_http_${f.httpStatus ?? "none"}`,
    evidence: end.href,
  };
}

// The full sentence, never the bare "Notify me" button label: raw HTML can
// carry button strings for states the page is not in.
const ZUMPER_REMOVED_RE = /Alert me when this rental is available/i;
const ZUMPER_LIVE_RE = /Check availability|Request tour/i;

function classifyZumper(f: LiveCheckFacts, listingId: string | null): LiveCheckOutcome {
  const end = parseUrl(f.endUrl);
  if (!end) return { verdict: "unknown", reason: "no_end_url", evidence: null };
  const endPath = end.pathname;

  if (/^\/(login|signin|manage)(\/|$)/i.test(endPath)) {
    return { verdict: "needs_login", reason: "login_redirect", evidence: end.href };
  }
  if (f.httpStatus === 404 || f.httpStatus === 410) {
    // Not measured on a real deleted listing yet; report, never flip.
    return {
      verdict: "unknown",
      reason: `zumper_http_${f.httpStatus}_unmeasured`,
      evidence: end.href,
    };
  }
  const onListing =
    !!listingId && new RegExp(`^/listings/${listingId}(?:/|$)`).test(endPath);
  if (!onListing) {
    return {
      verdict: "unknown",
      reason: "zumper_end_url_not_listing",
      evidence: end.href,
    };
  }
  const body = f.bodyText ?? "";
  const removedMarker = ZUMPER_REMOVED_RE.test(body);
  const liveMarker = ZUMPER_LIVE_RE.test(body);
  if (f.httpStatus === 200 && removedMarker && liveMarker) {
    // Both states in one document: a bundle or a hydration payload, not a
    // measured page state. Report, never flip.
    return {
      verdict: "unknown",
      reason: "zumper_conflicting_markers",
      evidence: end.href,
    };
  }
  if (f.httpStatus === 200 && removedMarker) {
    return {
      verdict: "removed",
      reason: "zumper_notify_me_page",
      evidence: `Zumper listing ${listingId} renders "Alert me when this rental is available" (no price, no inquiry CTA)`,
    };
  }
  if (f.httpStatus === 200 && liveMarker) {
    return {
      verdict: "live",
      reason: "zumper_inquiry_cta_present",
      evidence: `HTTP 200 on ${end.href} with an inquiry CTA`,
    };
  }
  return {
    verdict: "unknown",
    reason: `zumper_no_marker_http_${f.httpStatus ?? "none"}`,
    evidence: end.href,
  };
}

const RENTALS_CA_MISSED_RE = /Missed Shot|couldn.t find the page/i;
const RENTALS_CA_LIVE_RE = /Contact Property|Request a Tour|application\/ld\+json/i;

function classifyRentalsCa(f: LiveCheckFacts): LiveCheckOutcome {
  const end = parseUrl(f.endUrl);
  if (!end) return { verdict: "unknown", reason: "no_end_url", evidence: null };
  const req = parseUrl(f.requestedUrl);
  const reqSegments = req ? req.pathname.split("/").filter(Boolean) : [];
  const endSegments = end.pathname.split("/").filter(Boolean);

  if (endSegments[0] === "login" || endSegments[0] === "manage") {
    return { verdict: "needs_login", reason: "login_redirect", evidence: end.href };
  }

  const samePath =
    reqSegments.length === 2 &&
    endSegments.length === 2 &&
    reqSegments[0] === endSegments[0] &&
    reqSegments[1] === endSegments[1];

  // Measured: a removed listing redirects to the bare city search page.
  if (
    reqSegments.length === 2 &&
    endSegments.length === 1 &&
    endSegments[0] === reqSegments[0]
  ) {
    if (f.httpStatus !== 200) {
      return {
        verdict: "unknown",
        reason: `rentals_ca_city_redirect_http_${f.httpStatus ?? "none"}`,
        evidence: end.href,
      };
    }
    return {
      verdict: "removed",
      reason: "rentals_ca_city_search_redirect",
      evidence: `Rentals.ca redirected ${req?.pathname ?? f.requestedUrl} to the ${endSegments[0]} search page`,
    };
  }

  const body = f.bodyText ?? "";
  if (samePath && RENTALS_CA_MISSED_RE.test(body)) {
    // The "Missed Shot" page was measured on a slug that never existed, not
    // on a removed listing. Report it; do not flip on it.
    return {
      verdict: "unknown",
      reason: "rentals_ca_not_found_page",
      evidence: end.href,
    };
  }
  if (samePath && f.httpStatus === 200 && RENTALS_CA_LIVE_RE.test(body)) {
    return {
      verdict: "live",
      reason: "rentals_ca_listing_page_200",
      evidence: `HTTP 200 on ${end.href}`,
    };
  }
  return {
    verdict: "unknown",
    reason: `rentals_ca_no_marker_http_${f.httpStatus ?? "none"}`,
    evidence: end.href,
  };
}

export function classifyListingPostLiveCheck(
  f: LiveCheckFacts,
  target?: Pick<LiveCheckTarget, "externalId"> | null,
): LiveCheckOutcome {
  if (!isLiveCheckPortal(f.portal)) {
    return { verdict: "unsupported", reason: "portal_not_checkable", evidence: null };
  }
  if (f.fetchError) {
    return {
      verdict: "unreachable",
      reason: "fetch_error",
      evidence: String(f.fetchError).slice(0, 200),
    };
  }
  const wall = isChallenge(f);
  if (wall) return wall;

  const externalId = target?.externalId ?? null;
  if (f.portal === "kijiji") return classifyKijiji(f, externalId);
  if (f.portal === "zumper") return classifyZumper(f, externalId);
  return classifyRentalsCa(f);
}

// --- row patch ---------------------------------------------------------------

export type LiveCheckRowPatch = {
  status: "removed";
  notes: string;
};

function stamp(nowISO: string): string {
  // "2026-09-07 22:40Z" from an ISO string; falls back to the raw value.
  const m = nowISO.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}Z` : nowISO;
}

export function liveCheckNoteLine(
  outcome: LiveCheckOutcome,
  nowISO: string,
): string {
  const ev = outcome.evidence ? ` ${outcome.evidence}.` : "";
  return `live-check ${stamp(nowISO)}: REMOVED (${outcome.reason}).${ev} Row flipped live -> removed by the listing-post live check; nothing was re-posted.`;
}

/**
 * The only write the check makes. Returns null unless the row is `live` and
 * the verdict is `removed`; the note is appended, never replaced.
 */
export function liveCheckRowPatch(
  row: { status: string | null | undefined; notes: string | null | undefined },
  outcome: LiveCheckOutcome,
  nowISO: string,
): LiveCheckRowPatch | null {
  if (row.status !== "live") return null;
  if (!LIVE_CHECK_WRITABLE_VERDICTS.includes(outcome.verdict)) return null;
  const line = liveCheckNoteLine(outcome, nowISO);
  const prior = (row.notes ?? "").replace(/\s+$/, "");
  return { status: "removed", notes: prior ? `${prior}\n${line}` : line };
}
