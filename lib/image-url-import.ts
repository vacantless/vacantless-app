// Pure, dependency-free helpers for importing rental photos from operator-pasted
// image URLs (REAL-WORLD-INTAKE item Q, Phase 1: direct image links).
//
// The risky part of fetching an operator-supplied URL server-side is SSRF — a
// link that points at an internal/cloud-metadata address could make our server
// reach somewhere it shouldn't. Everything here is deterministic and unit-tested
// (scripts/test-image-url-import.ts) so the server action and the tests agree on
// exactly which hosts/addresses are refused and which bytes count as an image.
// The action layer adds the impure parts (DNS resolution of the hostname +
// re-validation of every resolved address, a size/timeout-capped fetch, and the
// per-redirect-hop re-check) — this module is the rules those parts enforce.
//
// No Supabase / Next imports.

import {
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  type AllowedPhotoType,
} from "./photos";

// A generous parse ceiling so a giant paste can't blow up the request; the
// server action still clamps the *imported* count to the plan's photo cap.
export const MAX_IMPORT_URLS = 50;

// Re-export the per-image byte ceiling so callers don't reach past this module.
export { MAX_PHOTO_BYTES };

// ---------------------------------------------------------------------------
// Parse a pasted blob of text into candidate URLs
// ---------------------------------------------------------------------------

/**
 * Split a pasted blob into candidate URLs. Operators paste one-per-line, but we
 * also tolerate commas and stray whitespace. Order is preserved, exact
 * duplicates are dropped, and the result is capped at MAX_IMPORT_URLS.
 */
export function parseImageUrls(text: string | null | undefined): string[] {
  if (typeof text !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const t = raw.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_IMPORT_URLS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// IP-literal classification (the core SSRF guard)
// ---------------------------------------------------------------------------

/** Parse "a.b.c.d" into 4 octets, or null if it isn't a dotted-quad. */
export function parseIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map((n) => Number(n));
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts;
}

/**
 * Is this IPv4 address private, loopback, link-local, or otherwise not a
 * public, routable destination? Blocking these is what stops an import URL from
 * reaching an internal service or the cloud metadata endpoint (169.254.169.254).
 */
export function isPrivateOrReservedIpv4(parts: number[]): boolean {
  if (parts.length !== 4) return true; // malformed -> refuse
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (+ metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

/**
 * Is this string an IPv6 literal we should refuse? We block loopback,
 * unspecified, link-local (fe80::/10), unique-local (fc00::/7), and
 * IPv4-mapped addresses whose embedded IPv4 is itself private/reserved. Anything
 * that isn't clearly a public global-unicast address is refused (fail-closed):
 * the legitimate image host case is a normal domain name, not an IPv6 literal.
 */
export function isBlockedIpv6(host: string): boolean {
  let h = host.trim().toLowerCase();
  // URL hosts wrap IPv6 in brackets; tolerate them being present or not.
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  // Strip a zone id (e.g. fe80::1%eth0) — its presence alone is link-local-ish.
  const pct = h.indexOf("%");
  if (pct !== -1) return true;
  if (!h.includes(":")) return false; // not an IPv6 literal
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  // IPv4-mapped / -compatible (::ffff:1.2.3.4) -> validate the embedded IPv4.
  const v4tail = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4tail) {
    const v4 = parseIpv4(v4tail[1]);
    return v4 === null ? true : isPrivateOrReservedIpv4(v4);
  }
  const first = h.split(":")[0];
  if (first.startsWith("fe8") || first.startsWith("fe9") ||
      first.startsWith("fea") || first.startsWith("feb")) return true; // fe80::/10
  if (first.startsWith("fc") || first.startsWith("fd")) return true; // fc00::/7 ULA
  // Global unicast lives in 2000::/3 (first hex digit 2 or 3). Anything else
  // (including ::-prefixed shorthand we didn't recognise) is refused.
  const lead = first === "" ? "" : first[0];
  if (lead === "2" || lead === "3") return false;
  return true;
}

/**
 * True if a *resolved* IP address (v4 or v6 literal) must not be connected to.
 * The action calls this against every address DNS returns for the hostname.
 */
export function isBlockedAddress(addr: string): boolean {
  const v4 = parseIpv4(addr);
  if (v4) return isPrivateOrReservedIpv4(v4);
  if (addr.includes(":")) return isBlockedIpv6(addr);
  return true; // not a recognisable IP literal -> refuse
}

// ---------------------------------------------------------------------------
// Hostname-level guard (applied to the URL before any DNS lookup)
// ---------------------------------------------------------------------------

const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "metadata.google.internal",
]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

/** Refuse obviously-internal hostnames and any private/reserved IP literal. */
export function isBlockedHost(host: string | null | undefined): boolean {
  if (!host) return true;
  const h = host.trim().toLowerCase().replace(/\.$/, ""); // drop trailing dot
  if (!h) return true;
  if (BLOCKED_HOST_EXACT.has(h)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  // IP literals are checked directly (no DNS needed).
  const bracketed = h.startsWith("[") && h.endsWith("]");
  if (bracketed || h.includes(":")) return isBlockedIpv6(h);
  const v4 = parseIpv4(h);
  if (v4) return isPrivateOrReservedIpv4(v4);
  return false; // a normal domain name -> allowed at this layer (DNS re-checks)
}

// ---------------------------------------------------------------------------
// URL syntax + scheme validation
// ---------------------------------------------------------------------------

export type UrlValidation =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: "invalid" | "scheme" | "credentials" | "host" };

/**
 * Validate one candidate URL for import: must be a well-formed http(s) URL with
 * no embedded credentials and a host that passes {@link isBlockedHost}. Returns
 * the canonical href + lowercased hostname for the action to resolve + fetch.
 */
export function validateImageUrl(raw: string): UrlValidation {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials" };
  }
  if (isBlockedHost(u.hostname)) {
    return { ok: false, reason: "host" };
  }
  return { ok: true, url: u.href, host: u.hostname.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Image-type detection (never trust the Content-Type header alone)
// ---------------------------------------------------------------------------

/** Map a Content-Type header to an allowed image type, or null. */
export function imageTypeFromContentType(
  ct: string | null | undefined,
): AllowedPhotoType | null {
  if (typeof ct !== "string") return null;
  const base = ct.split(";")[0]?.trim().toLowerCase();
  // image/jpg is a common (non-canonical) alias for image/jpeg.
  const norm = base === "image/jpg" ? "image/jpeg" : base;
  return (ALLOWED_PHOTO_TYPES as readonly string[]).includes(norm ?? "")
    ? (norm as AllowedPhotoType)
    : null;
}

/**
 * Identify an image from its leading magic bytes. This is the authoritative
 * check — a server can claim any Content-Type, so the stored type comes from the
 * actual bytes. Returns null if the bytes aren't a supported image.
 */
export function sniffImageType(
  bytes: Uint8Array | number[],
): AllowedPhotoType | null {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < 12) return null;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Result messaging
// ---------------------------------------------------------------------------

export type ImportUrlError = "urlnone" | "urlmax" | "urlfailed";

/** Plain-language copy for a URL-import failure surfaced via ?photoerr=. */
export function importUrlErrorMessage(reason: string): string {
  switch (reason) {
    case "urlnone":
      return "No image links found. Paste one direct image link per line (each should end in .jpg, .png, .webp, or .gif).";
    case "urlmax":
      return "That would go over this rental's photo limit. Remove a few links and try again.";
    case "urlfailed":
      return "None of those links could be imported. Make sure each is a direct, public image link (not a gallery or login-protected page).";
    default:
      return "Sorry, importing from links didn't work. Please try again.";
  }
}
