// ============================================================================
// Pure validation for the org's PUBLIC CONTACT details (the syndication feed's
// account-level contact block). No DOM / env / IO — fully unit-testable
// (see scripts/test-public-contact.ts).
//
// These two fields feed the <contact> block of the listing syndication feed
// (lib/listing-feed.ts buildListingFeedXml). An aggregator (Rentsync / Zumper /
// PadMapper) REQUIRES a contact phone per feed/account, so the operator surface
// in Settings asks for it; the email is optional (the feed falls back to the
// org's reply-to email in SQL when this is null).
//
// Both are optional at the form level: a blank value means "unset" (null), not
// an error — an operator can save the card before they've decided on a public
// number. The feed's own readiness check is what flags a still-missing phone.
// ============================================================================

// Conservative single-address check, mirrors lib/branding's EMAIL_RE: one
// local@domain.tld, no whitespace, no list/display-name syntax.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export const MAX_PUBLIC_PHONE_LEN = 40;
export const MAX_PUBLIC_EMAIL_LEN = 254;

export type PublicPhoneResult =
  | { ok: true; value: string | null }
  | { ok: false };

export type PublicEmailResult =
  | { ok: true; value: string | null }
  | { ok: false };

/**
 * Validate a public contact phone. Blank/whitespace is valid and means "unset"
 * (value: null). A non-empty value must contain 7–15 digits (NANP local 7 up
 * to the E.164 max 15) — but we PRESERVE the operator's own formatting (e.g.
 * "(226) 773-7555" or "+1 226-773-7555") rather than normalizing, because the
 * feed shows it verbatim and operators recognize their own number.
 */
export function validatePublicContactPhone(
  input: string | null | undefined,
): PublicPhoneResult {
  const s = (input ?? "").trim();
  if (s === "") return { ok: true, value: null };
  if (s.length > MAX_PUBLIC_PHONE_LEN) return { ok: false };
  // Only digits, spaces, and the usual phone punctuation are allowed.
  if (!/^[0-9+()\-.\s]+$/.test(s)) return { ok: false };
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return { ok: false };
  return { ok: true, value: s };
}

/**
 * Validate a public contact email. Blank is valid (value: null = fall back to
 * the reply-to email in the feed). A non-empty value must look deliverable.
 * Lowercased on save so the stored value is canonical.
 */
export function validatePublicContactEmail(
  input: string | null | undefined,
): PublicEmailResult {
  const s = (input ?? "").trim();
  if (s === "") return { ok: true, value: null };
  if (s.length > MAX_PUBLIC_EMAIL_LEN) return { ok: false };
  if (!EMAIL_RE.test(s)) return { ok: false };
  return { ok: true, value: s.toLowerCase() };
}

export type PublicContactResult =
  | {
      ok: true;
      values: {
        public_contact_phone: string | null;
        public_contact_email: string | null;
      };
    }
  | { ok: false; field: "phone" | "email" };

/**
 * Validate both public contact fields together for the Settings save. Returns
 * the normalized column values on success, or which field failed so the form
 * can show a precise message. Phone is checked first.
 */
export function validatePublicContact(input: {
  phone: string | null | undefined;
  email: string | null | undefined;
}): PublicContactResult {
  const phone = validatePublicContactPhone(input.phone);
  if (!phone.ok) return { ok: false, field: "phone" };
  const email = validatePublicContactEmail(input.email);
  if (!email.ok) return { ok: false, field: "email" };
  return {
    ok: true,
    values: {
      public_contact_phone: phone.value,
      public_contact_email: email.value,
    },
  };
}
