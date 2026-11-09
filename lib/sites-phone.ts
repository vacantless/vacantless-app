// ============================================================================
// sites-phone (S768, REVIEW-S761 section 5 item 1). Phone first, then "do this
// once on a computer".
//
// The three site sign-ins and the Marketplace helper need a computer (the
// helper is a Chrome extension; the sign-in windows are built for a desktop
// browser). A landlord who opens "Connect your rental sites" on a phone gets
// one line saying so, a button that emails them the link to open on their
// computer, and the Marketplace kit as the thing they can do from the phone.
// Pure: no I/O, so the copy and the rules are tested.
// ============================================================================

import { SITES_SETUP_HREF } from "@/lib/sites-setup";

/** Phones and tablets by user agent. iPadOS that reports "Macintosh" is caught in the browser. */
export function isPhoneUserAgent(ua: string | null | undefined): boolean {
  const s = (ua ?? "").trim();
  if (!s) return false;
  return /iPhone|iPad|iPod|Android|Mobile|Windows Phone|webOS|BlackBerry/i.test(s);
}

export const SITES_PHONE_LINE =
  "Signing in to Kijiji, Rentals.ca and Zumper needs a computer. So does the free Marketplace helper. We can email you the link to open there.";

export const SITES_PHONE_BUTTON = "Email me the link";

/** Where the emailed link lands: this page, keeping the rental the landlord came from. */
export function sitesComputerPath(propertyId: string | null | undefined): string {
  const id = (propertyId ?? "").trim();
  return id ? `${SITES_SETUP_HREF}?property=${encodeURIComponent(id)}` : SITES_SETUP_HREF;
}

/** What the landlord can still do from the phone: the Marketplace kit. */
export function sitesPhoneMarketplaceHref(propertyId: string | null | undefined): string {
  const id = (propertyId ?? "").trim();
  return id
    ? `/dashboard/properties/${encodeURIComponent(id)}?tab=distribute#for-you-facebook`
    : "/dashboard/properties";
}

export function sitesComputerEmail(input: { address: string | null }): { subject: string; body: string } {
  const where = (input.address ?? "").trim();
  return {
    subject: "Connect your rental sites from your computer",
    body:
      "Open this email on your computer. Then press the button below.\n\n" +
      "It opens Connect your rental sites in Vacantless" +
      (where ? `, for ${where}` : "") +
      ".\n" +
      "Sign in to Kijiji, Rentals.ca and Zumper there, one after the other.\n" +
      "Then add the free Marketplace helper to Chrome.\n" +
      "After that, every rental you post goes up on those sites for you. If a site signs you out, we tell you.\n\n" +
      "If Vacantless asks you to sign in, use the same email as this one.",
  };
}

/** The status line after the button, from ?mailed=. */
export function sitesPhoneMailedLine(mailed: string | null | undefined, email: string | null | undefined): string | null {
  if (mailed === "1") {
    const to = (email ?? "").trim();
    return to ? `Sent to ${to}. Open it on your computer.` : "Sent. Open it on your computer.";
  }
  if (mailed === "0") return "We couldn't send it. Try again in a minute, or open app.vacantless.com on your computer.";
  return null;
}
