// Pure helpers for the Settings "Send a test email" feature.
//
// Lets an operator email themselves a copy of the branded renter auto-reply so
// they can confirm deliverability + branding (sender name, colour, logo,
// reply-to) BEFORE sharing their intake link with real renters. The actual send
// reuses the existing Brevo plumbing in lib/email.ts (no new credentials).
//
// No DB / no Next / no env here so it unit-tests directly with
// `npx tsx scripts/test-test-email.ts`, the same discipline as lib/branding.ts.

// Conservative single-address check, mirroring EMAIL_RE in lib/branding.ts:
// one local@domain.tld, no whitespace, no list/display-name syntax. Enough to
// keep a malformed value out of the Brevo `to` field.
const RECIPIENT_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export type RecipientResult = { ok: true; value: string } | { ok: false };

/**
 * Validate the test-email recipient. Unlike the optional reply-to, a test send
 * REQUIRES a real recipient: non-blank, a single deliverable-looking address,
 * at most 254 chars. Lowercased so the stored/echoed value is canonical.
 */
export function validateTestRecipient(
  input: string | null | undefined,
): RecipientResult {
  const s = (input ?? "").trim();
  if (s === "") return { ok: false };
  if (s.length > 254) return { ok: false };
  if (!RECIPIENT_RE.test(s)) return { ok: false };
  return { ok: true, value: s.toLowerCase() };
}

// Realistic sample renter + listing data shown in the test email so the
// operator sees a fully-populated version of what a real renter receives
// (greeting, property line with rent, branded card). Kept here as the single
// source of truth so the composer and its tests agree.
export const TEST_SAMPLE = {
  renter_name: "Sample Renter",
  property_address: "123 Example Ave, Unit 4",
  rent_cents: 185000,
} as const;

// Prefix that marks a send as a test in the subject line, so the operator can
// tell it apart from a real renter auto-reply in their inbox.
export const TEST_SUBJECT_PREFIX = "[Test] ";
