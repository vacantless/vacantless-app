// ============================================================================
// Virtual tour / listing video LINK field (REAL-WORLD-INTAKE item S, S265).
// Pure, dependency-free helpers — no DOM / env / IO, fully unit-tested
// (scripts/test-virtual-tour.ts).
//
// A realtor's MLS data sheet (and realtor.ca) carries a virtual-tour URL — an
// iGUIDE 3D tour, a Matterport scan, or a YouTube/Vimeo video. realtor.ca shows
// it; Vacantless should match that on the public /r page and ride it to the
// portals via the fill sheet + feed. This module is the rules layer for that one
// nullable `virtual_tour_url` field.
//
// SECURITY POSTURE: unlike item Q's photo import, this URL is never fetched
// server-side — it is rendered as an <iframe src> in the renter's browser. So
// the threat is NOT SSRF; it is XSS / clickjacking / loading a hostile origin in
// a frame. The defense is an ALLOW-LIST, not a deny-list: we only ever produce an
// embed for a small set of known tour hosts (YouTube / Vimeo / iGUIDE /
// Matterport), reject any non-https or credentialed URL, and RECONSTRUCT the
// embed URL from validated, host-canonical parts rather than passing operator
// text through to the iframe. A `javascript:` or `data:` URL can never reach the
// frame because the scheme is validated to https first and the host must match
// the allow-list. Same discipline as lib/image-url-import, allow-list flavour.
// ============================================================================

export const TOUR_PROVIDERS = [
  "youtube",
  "vimeo",
  "iguide",
  "matterport",
] as const;
export type TourProvider = (typeof TOUR_PROVIDERS)[number];

export type VirtualTour = {
  provider: TourProvider;
  /** Canonical https URL to STORE + link to (what we persist in virtual_tour_url). */
  href: string;
  /**
   * A safe https URL to use as an <iframe src>, or null when the provider/URL
   * isn't embeddable and we should render a plain "View virtual tour" link.
   */
  embedUrl: string | null;
  /** Human label for the provider, e.g. "iGUIDE tour", "YouTube video". */
  label: string;
};

export type VirtualTourResult =
  | { ok: true; tour: VirtualTour }
  | {
      ok: false;
      reason: "empty" | "invalid" | "scheme" | "credentials" | "host";
    };

// ---------------------------------------------------------------------------
// Allow-list: which hosts map to which provider. A host matches a base when it
// equals the base or is a subdomain of it (so unbranded.youriguide.com,
// my.matterport.com, m.youtube.com all match). Nothing outside this list ever
// produces an embed.
// ---------------------------------------------------------------------------

const PROVIDER_HOSTS: Record<TourProvider, readonly string[]> = {
  youtube: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
  vimeo: ["vimeo.com"],
  iguide: ["youriguide.com", "iguide.com"],
  matterport: ["matterport.com"],
};

const PROVIDER_LABEL: Record<TourProvider, string> = {
  youtube: "YouTube video",
  vimeo: "Vimeo video",
  iguide: "iGUIDE tour",
  matterport: "Matterport tour",
};

/** True when `host` equals `base` or is a subdomain of it. */
export function hostMatches(host: string, base: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === base || h.endsWith(`.${base}`);
}

/** The allow-listed provider for a hostname, or null if not allow-listed. */
export function providerForHost(host: string | null | undefined): TourProvider | null {
  if (!host) return null;
  for (const provider of TOUR_PROVIDERS) {
    if (PROVIDER_HOSTS[provider].some((base) => hostMatches(host, base))) {
      return provider;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-provider id/URL extraction. Each takes a parsed URL and returns the safe
// embed URL (reconstructed from a validated id, or the canonical page URL for
// the 3D-tour hosts), plus the canonical href to store. embedUrl is null when
// the host is right but we can't pin an embeddable form (render a link instead).
// ---------------------------------------------------------------------------

/** YouTube video id: 11-char id from watch?v=, youtu.be/<id>, /embed, /shorts, /live. */
function youtubeEmbed(u: URL): { href: string; embedUrl: string | null } {
  const idRe = /^[A-Za-z0-9_-]{6,15}$/;
  let id: string | null = null;
  if (hostMatches(u.hostname, "youtu.be")) {
    id = u.pathname.split("/").filter(Boolean)[0] ?? null;
  } else {
    const v = u.searchParams.get("v");
    if (v) id = v;
    else {
      const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  if (id && idRe.test(id)) {
    return {
      href: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  }
  // Allow-listed host but no recognizable id — link only, no iframe.
  return { href: canonicalHttps(u), embedUrl: null };
}

/** Vimeo numeric id from the first numeric path segment. */
function vimeoEmbed(u: URL): { href: string; embedUrl: string | null } {
  const seg = u.pathname.split("/").filter(Boolean);
  const id = seg.find((s) => /^\d{6,12}$/.test(s)) ?? null;
  if (id) {
    return {
      href: `https://vimeo.com/${id}`,
      embedUrl: `https://player.vimeo.com/video/${id}`,
    };
  }
  return { href: canonicalHttps(u), embedUrl: null };
}

/** Matterport model id from ?m=<id>; otherwise the canonical page (link only). */
function matterportEmbed(u: URL): { href: string; embedUrl: string | null } {
  const m = u.searchParams.get("m");
  if (m && /^[A-Za-z0-9]{6,24}$/.test(m)) {
    const embed = `https://my.matterport.com/show/?m=${m}`;
    return { href: embed, embedUrl: embed };
  }
  return { href: canonicalHttps(u), embedUrl: null };
}

/**
 * iGUIDE pages embed directly in an iframe, so the canonical https page URL IS
 * the embed URL. We keep the host + path the operator gave (validated to be an
 * iGUIDE host) and force https.
 */
function iguideEmbed(u: URL): { href: string; embedUrl: string | null } {
  const href = canonicalHttps(u);
  return { href, embedUrl: href };
}

/** Rebuild an https URL from a validated URL's host + path + query (drops creds/hash). */
function canonicalHttps(u: URL): string {
  const search = u.search ?? "";
  return `https://${u.hostname.toLowerCase()}${u.pathname}${search}`;
}

const EMBEDDERS: Record<TourProvider, (u: URL) => { href: string; embedUrl: string | null }> = {
  youtube: youtubeEmbed,
  vimeo: vimeoEmbed,
  iguide: iguideEmbed,
  matterport: matterportEmbed,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate + classify a virtual-tour URL. Accepts only a well-formed https URL
 * (we also upgrade a bare-host http URL to https) with no embedded credentials
 * whose host is on the provider allow-list. Returns the provider, the canonical
 * href to store, and a safe iframe `embedUrl` (or null = link only).
 */
export function parseVirtualTour(raw: string | null | undefined): VirtualTourResult {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "empty" };
  }
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials" };
  }
  const provider = providerForHost(u.hostname);
  if (!provider) {
    return { ok: false, reason: "host" };
  }
  const { href, embedUrl } = EMBEDDERS[provider](u);
  return {
    ok: true,
    tour: { provider, href, embedUrl, label: PROVIDER_LABEL[provider] },
  };
}

/** The canonical https URL to STORE for a valid tour URL, or null if invalid. */
export function normalizeVirtualTourUrl(raw: string | null | undefined): string | null {
  const r = parseVirtualTour(raw);
  return r.ok ? r.tour.href : null;
}

/** The {@link VirtualTour} for a stored URL, or null when absent/invalid. */
export function virtualTourFor(raw: string | null | undefined): VirtualTour | null {
  const r = parseVirtualTour(raw);
  return r.ok ? r.tour : null;
}

/** Plain-language copy for a rejected tour URL, surfaced via ?tourerr=. */
export function virtualTourErrorMessage(reason: string): string {
  switch (reason) {
    case "host":
      return "That link isn't from a supported tour host. Use a YouTube, Vimeo, iGUIDE, or Matterport link.";
    case "scheme":
    case "credentials":
    case "invalid":
      return "That doesn't look like a valid tour link. Paste the full https:// link to the tour or video.";
    default:
      return "Please paste a YouTube, Vimeo, iGUIDE, or Matterport link.";
  }
}
