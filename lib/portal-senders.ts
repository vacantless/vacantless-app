// Global trusted-portal-sender registry + ALIGNED auth guard for the lead ingest
// (S568, lane B). The syndication portals (Rentals.ca today; Zumper / Kijiji
// later) email a tenant lead from their OWN system address — contact@rentals.ca,
// no-reply@rentals.ca — identical for every customer and unable to click a
// double-opt-in confirm link. So the per-org verified-sender allow-list
// (lib/email-ingest, built for "forward from your own email") cannot admit them:
// the two Rentals.ca senders were added to the dogfooding org by hand SQL, and
// that hand step blocks onboarding a second and third org.
//
// THE MODEL (platform list, not per-org rows). One registry in code. Any org's
// lead ingest address trusts these senders — no SQL, no per-org copy, and a new
// portal is a one-line change applying to every org at once. The org's
// unguessable ingest token stays the real boundary; the s566/s567 cross-org ad
// guard in the route is untouched (this only decides whether a message may become
// a lead at all, never which org it lands under).
//
// A KNOWN PORTAL ADDRESS IS GOVERNED BY THIS GUARD, NOT BY PER-ORG ROWS. The
// route checks known-portal senders through here EVEN IF a legacy per-org row
// exists for the same address, so a hand-added contact@rentals.ca row can never
// bypass authentication (Codex S568 P1a).
//
// THE AUTH GUARD IS ALIGNED + FAIL-CLOSED. A known portal address is spoofable in
// the From line, so trust requires the inbound provider's authentication verdict
// (Postmark passes Authentication-Results / Received-SPF through) AND domain
// ALIGNMENT to the portal's own domain — a bare spf=pass authenticates only the
// envelope domain, which an attacker controls (Codex S568 P1b). Trust iff:
//   * dmarc = pass                                  (aligned to header.from by
//                                                    definition; From already
//                                                    matched the portal address), OR
//   * dkim  = pass AND header.d aligns to the portal domain, OR
//   * spf   = pass AND the mailfrom domain aligns to the portal domain.
// Anything else — explicit fail, unaligned pass, or no conclusive verdict — is
// NOT trusted. Pure + deterministic; unit-tested in scripts/test-portal-senders.ts.
//
// ENFORCEMENT vs OBSERVE lives in the ROUTE, not here: this function always
// returns the strict verdict. The route may run in observe mode (accept-but-log)
// until a first real delivery confirms Postmark's header shape, then enforce.

import { normalizeSenderEmail } from "./email-ingest";

export type PortalKey = "rentals_ca";

type PortalEntry = { addresses: string[]; domain: string };

// The registry. Grouped by portal so adding Zumper / Kijiji later is one entry.
// Addresses are EXACT (not whole-domain). `domain` is the organizational domain
// alignment is checked against.
export const PORTAL_REGISTRY: Record<PortalKey, PortalEntry> = {
  rentals_ca: {
    addresses: ["contact@rentals.ca", "no-reply@rentals.ca"],
    domain: "rentals.ca",
  },
};

// Back-compat flat list (some callers/tests want just the addresses).
export const KNOWN_PORTAL_SENDERS: Record<PortalKey, string[]> = {
  rentals_ca: PORTAL_REGISTRY.rentals_ca.addresses,
};

const ADDRESS_TO_ENTRY: ReadonlyMap<string, PortalEntry> = new Map(
  Object.values(PORTAL_REGISTRY).flatMap((e) =>
    e.addresses.map((a) => [a.toLowerCase(), e] as [string, PortalEntry]),
  ),
);

/** The portal entry for `from`, or null. Uses the SAME normalization as the
 *  per-org allow-list so '"Rentals.ca" <Contact@Rentals.CA>' matches. */
export function portalEntryForSender(from: unknown): PortalEntry | null {
  const sender = normalizeSenderEmail(from);
  if (!sender) return null;
  return ADDRESS_TO_ENTRY.get(sender) ?? null;
}

/** Is `from` one of the globally-trusted portal system addresses? */
export function isKnownPortalSender(from: unknown): boolean {
  return portalEntryForSender(from) != null;
}

export type AuthVerdict = "pass" | "fail" | "none";

export type InboundAuthResults = {
  dkim: AuthVerdict;
  dkimDomain: string | null; // header.d / header.i
  spf: AuthVerdict;
  spfDomain: string | null; // smtp.mailfrom / Received-SPF envelope-from
  dmarc: AuthVerdict;
  dmarcFrom: string | null; // header.from
};

function headerValue(
  headers: Record<string, string> | null | undefined,
  name: string,
): string {
  if (!headers) return "";
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v ?? "";
  }
  return "";
}

// The ';'-delimited segment of an Authentication-Results header that carries a
// given method (dkim= / spf= / dmarc=). Domains are extracted from WITHIN that
// segment so a pass for one method can't borrow another's domain.
function methodSegment(authResults: string, method: string): string {
  for (const seg of authResults.split(";")) {
    if (new RegExp(`(^|\\s)${method}\\s*=`, "i").test(seg)) return seg;
  }
  return "";
}

function verdictIn(segment: string, method: string): AuthVerdict {
  const m = segment.match(
    new RegExp(`${method}\\s*=\\s*(pass|fail|none|neutral|softfail|temperror|permerror)`, "i"),
  );
  if (!m) return "none";
  const r = m[1].toLowerCase();
  if (r === "pass") return "pass";
  if (r === "fail" || r === "softfail" || r === "permerror") return "fail";
  return "none";
}

function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase().replace(/^@/, "");
  const at = v.lastIndexOf("@");
  if (at >= 0) v = v.slice(at + 1);
  v = v.replace(/[>;,)\s].*$/, ""); // trim trailing junk
  return v || null;
}

/** Parse Authentication-Results (+ Received-SPF fallback) into verdicts AND the
 *  authenticated domains needed for alignment. Absent/inconclusive -> "none".
 *  Never throws. */
export function parseInboundAuthResults(
  headers: Record<string, string> | null | undefined,
): InboundAuthResults {
  const ar = headerValue(headers, "Authentication-Results");
  const receivedSpf = headerValue(headers, "Received-SPF");

  const dkimSeg = methodSegment(ar, "dkim");
  const spfSeg = methodSegment(ar, "spf");
  const dmarcSeg = methodSegment(ar, "dmarc");

  const dkim = verdictIn(dkimSeg, "dkim");
  const dkimDomain =
    domainOf(dkimSeg.match(/header\.d\s*=\s*([^\s;]+)/i)?.[1]) ??
    domainOf(dkimSeg.match(/header\.i\s*=\s*([^\s;]+)/i)?.[1]);

  let spf = verdictIn(spfSeg, "spf");
  let spfDomain =
    domainOf(spfSeg.match(/smtp\.mailfrom\s*=\s*([^\s;]+)/i)?.[1]) ??
    domainOf(spfSeg.match(/smtp\.helo\s*=\s*([^\s;]+)/i)?.[1]);

  const dmarc = verdictIn(dmarcSeg, "dmarc");
  const dmarcFrom = domainOf(dmarcSeg.match(/header\.from\s*=\s*([^\s;]+)/i)?.[1]);

  // Received-SPF fallback ONLY when Authentication-Results carried no spf verdict.
  // Format: "pass (mx: domain of bounce@rentals.ca ...) envelope-from=bounce@rentals.ca"
  if (spf === "none" && receivedSpf) {
    const rm = receivedSpf.trim().match(/^(pass|fail|softfail|neutral|none|temperror|permerror)/i);
    if (rm) {
      const r = rm[1].toLowerCase();
      spf = r === "pass" ? "pass" : r === "fail" || r === "softfail" || r === "permerror" ? "fail" : "none";
    }
    spfDomain =
      domainOf(receivedSpf.match(/envelope-from\s*=\s*([^\s;)]+)/i)?.[1]) ??
      domainOf(receivedSpf.match(/domain of\s+([^\s;)]+)/i)?.[1]) ??
      spfDomain;
  }

  return { dkim, dkimDomain, spf, spfDomain, dmarc, dmarcFrom };
}

/** Relaxed organizational-domain alignment: exact match or a subdomain of the
 *  portal domain. */
export function domainAligns(candidate: string | null | undefined, portalDomain: string): boolean {
  const c = domainOf(candidate);
  if (!c) return false;
  return c === portalDomain || c.endsWith(`.${portalDomain}`);
}

/**
 * The full lead-channel portal trust decision: known portal sender AND an ALIGNED
 * authentication pass (dmarc pass, or dkim/spf pass aligned to the portal domain).
 * Fail-closed on explicit fail, unaligned pass, or no conclusive verdict.
 */
export function isTrustedPortalSender(
  from: unknown,
  headers: Record<string, string> | null | undefined,
): boolean {
  const entry = portalEntryForSender(from);
  if (!entry) return false;
  const v = parseInboundAuthResults(headers);

  // DMARC pass is aligned to header.from by definition, and `from` already
  // matched a portal address, so header.from IS the portal domain.
  if (v.dmarc === "pass") return true;
  // Aligned DKIM.
  if (v.dkim === "pass" && domainAligns(v.dkimDomain, entry.domain)) return true;
  // Aligned SPF (mailfrom aligned to the portal domain).
  if (v.spf === "pass" && domainAligns(v.spfDomain, entry.domain)) return true;
  return false;
}
