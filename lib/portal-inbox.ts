// ============================================================================
// Portal inbox (S697c). Everything a landlord needs to get renter inquiries
// from the rental sites into Vacantless WITHOUT asking us: which senders to
// make a rule for, whether the rule is working, and the one code Gmail makes
// them fetch from the forwarding address before it will forward anything.
//
// Pure. The server reads inbound_portal_events and hands the rows here; the
// ingest writes those rows. Nothing in this file touches the network or the DB.
//
// WHY GMAIL NEEDS A CASE OF ITS OWN. Gmail will not forward to a new address
// until the owner types a code that Gmail emails TO that address. For us that
// address is the org's ingest token, so the code arrived here and was dropped
// as an unknown sender: a Gmail landlord could never finish setup alone. The
// ingest now keeps that one code, and only after an aligned google.com auth
// pass, and the card shows it back to the org that owns the address.
//
// UNVERIFIED AGAINST A REAL MESSAGE. The sender and the code's position (the
// "(#123456789)" subject prefix, and "Confirmation code: 123456789" in the body)
// are Gmail's long-standing format, not read off a captured 2026 message. Both
// places are read so either one is enough. Confirm on the first real one.
// ============================================================================

import { domainAligns, parseInboundAuthResults, PORTAL_REGISTRY, type PortalKey } from "./portal-senders";
import { extractAddress } from "./email-ingest";

export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";
const GOOGLE_DOMAIN = "google.com";

export type PortalInboxSource = PortalKey | "gmail_forwarding";

export const PORTAL_INBOX_OUTCOMES = [
  "lead_created",
  "duplicate",
  "not_parsed",
  "auth_unverified",
  "cross_org_refused",
  "confirmation_code",
] as const;
export type PortalInboxOutcome = (typeof PORTAL_INBOX_OUTCOMES)[number];

export type PortalInboxEvent = {
  source: string;
  outcome: string;
  detail: string | null;
  received_at: string;
};

// ---- which sites are on ------------------------------------------------------

/** A site's ingest is on for every org. Kijiji waits on its own flag until a
 *  real delivery has been watched (S697); Rentals.ca has been on since S567. */
export function portalIngestEnabled(
  key: PortalKey,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (key === "kijiji") return env.KIJIJI_LEAD_INGEST_ENABLED === "true";
  return true;
}

export const PORTAL_INBOX_ORDER: PortalKey[] = ["kijiji", "rentals_ca"];

export const PORTAL_INBOX_LABEL: Record<PortalKey, string> = {
  kijiji: "Kijiji",
  rentals_ca: "Rentals.ca",
};

export type PortalInboxSite = { key: PortalKey; label: string; senders: string[] };

/** The sites to show, in order, each with the exact sender addresses a rule
 *  must match. Read from the same registry the ingest trusts, so the card can
 *  never tell a landlord to forward mail the ingest would refuse. */
export function portalInboxSites(
  env: Record<string, string | undefined> = process.env,
): PortalInboxSite[] {
  return PORTAL_INBOX_ORDER.filter((key) => portalIngestEnabled(key, env)).map((key) => ({
    key,
    label: PORTAL_INBOX_LABEL[key],
    senders: [...PORTAL_REGISTRY[key].addresses],
  }));
}

// ---- Gmail's forwarding code -------------------------------------------------

export function isGmailForwardingSender(from: unknown): boolean {
  return extractAddress(from) === GMAIL_FORWARDING_SENDER;
}

/** Aligned google.com authentication, the same bar a rental site's mail must
 *  clear. Without it anyone who learns an ingest address could plant a "code". */
export function isTrustedGoogleMail(
  headers: Record<string, string> | null | undefined,
): boolean {
  const v = parseInboundAuthResults(headers);
  if (v.dmarc === "pass" && domainAligns(v.dmarcFrom, GOOGLE_DOMAIN)) return true;
  if (v.dkim === "pass" && domainAligns(v.dkimDomain, GOOGLE_DOMAIN)) return true;
  if (v.spf === "pass" && domainAligns(v.spfDomain, GOOGLE_DOMAIN)) return true;
  return false;
}

/** Gmail's numeric confirmation code, or null. Digits only, 6 to 12 of them, so
 *  nothing but a code can ever reach the landlord's screen from this path. */
export function parseGmailForwardingCode(input: {
  subject?: string | null;
  textBody?: string | null;
}): string | null {
  const subject = input.subject ?? "";
  const fromSubject = subject.match(/\(#\s*(\d{6,12})\s*\)/);
  if (fromSubject) return fromSubject[1];
  const body = input.textBody ?? "";
  const fromBody = body.match(/confirmation code\s*:\s*(\d{6,12})\b/i);
  return fromBody ? fromBody[1] : null;
}

// ---- what the card says per site --------------------------------------------

export type PortalInboxSiteState =
  | { state: "none" }
  | { state: "working"; at: string }
  | { state: "unreadable"; at: string }
  | { state: "unverified"; at: string };

/** A code older than this is spent or stale; Gmail's own links expire too. */
export const GMAIL_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newestFirst(a: PortalInboxEvent, b: PortalInboxEvent): number {
  return Date.parse(b.received_at) - Date.parse(a.received_at);
}

/**
 * Per site, the state of the NEWEST event. "working" as soon as any inquiry
 * got through, and it stays working until a newer email fails: one good
 * delivery proves the rule, one later failure is the thing to show.
 */
export function summarizePortalInbox(
  sites: PortalInboxSite[],
  events: PortalInboxEvent[],
  now: number,
): {
  sites: Array<PortalInboxSite & { status: PortalInboxSiteState }>;
  gmailCode: { code: string; at: string } | null;
} {
  const sorted = [...events].sort(newestFirst);
  const out = sites.map((site) => {
    const latest = sorted.find((e) => e.source === site.key);
    let status: PortalInboxSiteState = { state: "none" };
    if (latest) {
      if (latest.outcome === "lead_created" || latest.outcome === "duplicate") {
        status = { state: "working", at: latest.received_at };
      } else if (latest.outcome === "auth_unverified") {
        status = { state: "unverified", at: latest.received_at };
      } else {
        status = { state: "unreadable", at: latest.received_at };
      }
    }
    return { ...site, status };
  });

  const code = sorted.find(
    (e) =>
      e.source === "gmail_forwarding" &&
      e.outcome === "confirmation_code" &&
      typeof e.detail === "string" &&
      /^\d{6,12}$/.test(e.detail) &&
      now - Date.parse(e.received_at) <= GMAIL_CODE_TTL_MS,
  );
  // Once a site has delivered after the code arrived, forwarding is proven and
  // the code is noise.
  const provenAfterCode =
    code != null &&
    out.some(
      (s) => s.status.state === "working" && Date.parse(s.status.at) > Date.parse(code.received_at),
    );

  return {
    sites: out,
    gmailCode: code && !provenAfterCode ? { code: code.detail as string, at: code.received_at } : null,
  };
}
