// ============================================================================
// site-mail-pass (S806). Rental site accounts that use the landlord's
// Vacantless address.
//
// Renters reach Vacantless with no mail rule when the Kijiji, Rentals.ca or
// Zumper account itself uses the Vacantless address ("Make my account" fills
// it in). Those sites also send that address everything else: the sign-up
// link, Rentals.ca's code, password resets, receipts, Zumper's ID check.
// Before S806 the ingest dropped all of it (loop guard, "not parsed"). This
// module decides which of those emails are really from a rental site, so the
// ingest can pass them on to the landlord's own inbox. Pure: no I/O.
//
// Trust: the sender's domain must be a rental site's, AND the email must
// pass aligned DMARC, DKIM or SPF for that domain. A stranger who learns the
// address cannot use it to put mail in the landlord's inbox.
// ============================================================================

import { domainAligns, parseInboundAuthResults } from "./portal-senders";
import { extractAddress } from "./email-ingest";

/** Organizational domains of the sites we sign landlords up to, and their names. */
export const SITE_MAIL_DOMAINS: Readonly<Record<string, string>> = {
  "kijiji.ca": "Kijiji",
  "rentals.ca": "Rentals.ca",
  "zumper.com": "Zumper",
  "zumperchat.com": "Zumper",
  "padmapper.com": "PadMapper",
};

/** The rental site domain an address belongs to, or null. */
export function siteMailDomain(from: unknown): string | null {
  const addr = extractAddress(from);
  if (!addr) return null;
  const host = addr.split("@")[1]?.toLowerCase() ?? "";
  for (const d of Object.keys(SITE_MAIL_DOMAINS)) {
    if (host === d || host.endsWith(`.${d}`)) return d;
  }
  return null;
}

export function siteMailName(domain: string): string {
  return SITE_MAIL_DOMAINS[domain] ?? domain;
}

/** From a rental site's domain, with aligned authentication for that domain. */
export function isTrustedSiteMail(
  from: unknown,
  headers: Record<string, string> | null | undefined,
): { ok: true; domain: string } | { ok: false; reason: "not_site" | "auth" } {
  const domain = siteMailDomain(from);
  if (!domain) return { ok: false, reason: "not_site" };
  const v = parseInboundAuthResults(headers);
  if (v.dmarc === "pass" && (v.dmarcFrom == null || domainAligns(v.dmarcFrom, domain))) return { ok: true, domain };
  if (v.dkim === "pass" && domainAligns(v.dkimDomain, domain)) return { ok: true, domain };
  if (v.spf === "pass" && domainAligns(v.spfDomain, domain)) return { ok: true, domain };
  return { ok: false, reason: "auth" };
}

/** The subject of the copy the landlord gets. */
export function siteMailCopySubject(siteName: string, subject: string): string {
  const s = subject.replace(/\s+/g, " ").trim().slice(0, 180);
  return s ? `${siteName}: ${s}` : `${siteName} sent you an email`;
}

/** The one line above the site's own email in the copy. */
export function siteMailCopyLead(siteName: string): string {
  return `${siteName} sent this to your Vacantless address. It is not from a renter, so we passed it on to you.`;
}
