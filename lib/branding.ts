// Pure validation + normalization for the owner branding settings (M4).
//
// These fields already exist on the `organizations` row and are consumed live:
//   - name        → dashboard header, public listing page, and the From display
//                    name + sign-off in every Brevo email (auto-reply, booking
//                    confirmation, showing reminder).
//   - brand_color → header bar, public page accent, and the email accent bar.
//   - logo_url    → public page + the email header image.
//
// Keeping the logic pure (no DB, no Next) lets it be unit-tested directly with
// `npx tsx scripts/test-branding.ts`, the same discipline as lib/reports.ts.

export const MAX_NAME_LEN = 120;
export const DEFAULT_BRAND_COLOR = "#4f46e5";

/**
 * Normalize a user-entered hex color to a canonical lowercase `#rrggbb`.
 * Accepts an optional leading `#`, 3- or 6-digit hex, any case, surrounding
 * whitespace. 3-digit shorthand (`#abc`) is expanded to `#aabbcc`.
 * Returns null if the input is not a valid hex color.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith("#")) s = s.slice(1);
  if (!/^[0-9a-f]+$/.test(s)) return null;
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (s.length !== 6) return null;
  return "#" + s;
}

export type LogoResult = { ok: true; value: string | null } | { ok: false };

/**
 * Validate a logo URL. An empty/blank value is valid and means "no logo"
 * (returns value: null). A non-empty value must be an absolute http(s) URL.
 * Anything else (relative paths, javascript:, mailto:, malformed) is rejected.
 */
export function validateLogoUrl(input: string | null | undefined): LogoResult {
  const s = (input ?? "").trim();
  if (s === "") return { ok: true, value: null };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false };
  return { ok: true, value: u.toString() };
}

export type NameResult = { ok: true; value: string } | { ok: false };

/** Validate the org/business name: non-empty after trim, at most MAX_NAME_LEN. */
export function validateOrgName(input: string | null | undefined): NameResult {
  const s = (input ?? "").trim();
  if (s === "") return { ok: false };
  if (s.length > MAX_NAME_LEN) return { ok: false };
  return { ok: true, value: s };
}

export type ReplyToResult = { ok: true; value: string | null } | { ok: false };

// Conservative single-address check: one local@domain.tld, no whitespace, no
// list/display-name syntax. We don't need RFC-5322 completeness — just enough
// to keep a malformed value out of the Brevo `replyTo`. Lowercased on save so
// the stored value is canonical.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/**
 * Validate the reply-to email. An empty/blank value is valid and means "use the
 * default sender" (returns value: null). A non-empty value must look like a
 * single deliverable address; anything else is rejected.
 */
export function validateReplyToEmail(input: string | null | undefined): ReplyToResult {
  const s = (input ?? "").trim();
  if (s === "") return { ok: true, value: null };
  if (s.length > 254) return { ok: false };
  if (!EMAIL_RE.test(s)) return { ok: false };
  return { ok: true, value: s.toLowerCase() };
}

export type BrandingInput = {
  name?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
  reply_to_email?: string | null;
};

export type BrandingUpdate = {
  name: string;
  brand_color: string;
  logo_url: string | null;
  reply_to_email: string | null;
};

export type BrandingValidation =
  | { ok: true; values: BrandingUpdate }
  | { ok: false; errors: string[] };

/**
 * Validate a full branding form submission. Returns the canonical values ready
 * to persist, or the list of field errors. All three fields are validated
 * together so the owner sees every problem at once rather than one at a time.
 */
export function validateBranding(input: BrandingInput): BrandingValidation {
  const errors: string[] = [];

  const name = validateOrgName(input.name);
  if (!name.ok) {
    errors.push(`Business name is required and must be ${MAX_NAME_LEN} characters or fewer.`);
  }

  const color = normalizeHexColor(input.brand_color);
  if (color == null) {
    errors.push("Brand color must be a valid hex color (e.g. #0e8c8c).");
  }

  const logo = validateLogoUrl(input.logo_url);
  if (!logo.ok) {
    errors.push("Logo URL must be a full http(s) link, or left blank.");
  }

  const replyTo = validateReplyToEmail(input.reply_to_email);
  if (!replyTo.ok) {
    errors.push("Reply-to must be a valid email address, or left blank.");
  }

  if (errors.length > 0 || !name.ok || color == null || !logo.ok || !replyTo.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name: name.value,
      brand_color: color,
      logo_url: logo.value,
      reply_to_email: replyTo.value,
    },
  };
}
