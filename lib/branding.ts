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
// Single source of truth lives in brand-theme; re-exported here so existing
// importers of `@/lib/branding` keep working.
export { DEFAULT_BRAND_COLOR, DEFAULT_BRAND_SECONDARY } from "./brand-theme";

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

export const MAX_FEEDBACK_DELAY_HOURS = 336; // 14 days
export const DEFAULT_FEEDBACK_DELAY_HOURS = 2;

export type DelayResult = { ok: true; value: number } | { ok: false };

/**
 * Validate the post-showing feedback delay (hours to wait after a showing
 * before emailing the feedback request). A blank value falls back to the
 * default. Must be a whole number from 0 to MAX_FEEDBACK_DELAY_HOURS.
 */
export function validateFeedbackDelayHours(
  input: string | number | null | undefined,
): DelayResult {
  if (input == null || (typeof input === "string" && input.trim() === "")) {
    return { ok: true, value: DEFAULT_FEEDBACK_DELAY_HOURS };
  }
  const n = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(n) || n < 0 || n > MAX_FEEDBACK_DELAY_HOURS) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

// ---------------------------------------------------------------------------
// Per-tab brand identity (S227 Settings restructure): the "Public Page & Brand"
// tab only owns the name + brand colors. Reply-to, feedback, follow-up, and SMS
// moved to the Communications tab and are validated/persisted by their own
// focused server actions, so this validates just these three fields together.
// validateBranding (below) is retained unchanged for its existing tests.
// ---------------------------------------------------------------------------
export type BrandIdentityUpdate = {
  name: string;
  brand_color: string;
  brand_color_secondary: string | null;
};

export type BrandIdentityValidation =
  | { ok: true; values: BrandIdentityUpdate }
  | { ok: false; errors: string[] };

/**
 * Validate the brand-identity fields (business name + brand color + optional
 * ombre second stop). Mirrors the name/color/secondary rules in validateBranding:
 * a blank/absent second stop, or one equal to the primary, collapses to null
 * (a solid). All fields are validated together so every problem surfaces at once.
 */
export function validateBrandIdentity(input: {
  name?: string | null;
  brand_color?: string | null;
  brand_color_secondary?: string | null;
}): BrandIdentityValidation {
  const errors: string[] = [];

  const name = validateOrgName(input.name);
  if (!name.ok) {
    errors.push(`Business name is required and must be ${MAX_NAME_LEN} characters or fewer.`);
  }

  const color = normalizeHexColor(input.brand_color);
  if (color == null) {
    errors.push("Brand color must be a valid hex color (e.g. #0e8c8c).");
  }

  const secondaryRaw = (input.brand_color_secondary ?? "").trim();
  let secondary: string | null = null;
  let secondaryOk = true;
  if (secondaryRaw !== "") {
    const s = normalizeHexColor(secondaryRaw);
    if (s == null) {
      secondaryOk = false;
      errors.push("Second brand color must be a valid hex color, or left blank.");
    } else {
      secondary = color != null && s === color ? null : s;
    }
  }

  if (errors.length > 0 || !name.ok || color == null || !secondaryOk) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name: name.value,
      brand_color: color,
      brand_color_secondary: secondary,
    },
  };
}

export type BrandingInput = {
  name?: string | null;
  brand_color?: string | null;
  brand_color_secondary?: string | null;
  logo_url?: string | null;
  reply_to_email?: string | null;
  feedback_enabled?: boolean;
  feedback_delay_hours?: string | number | null;
  nurture_enabled?: boolean;
  sms_enabled?: boolean;
};

export type BrandingUpdate = {
  name: string;
  brand_color: string;
  brand_color_secondary: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  feedback_enabled: boolean;
  feedback_delay_hours: number;
  nurture_enabled: boolean;
  sms_enabled: boolean;
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

  // Optional second ombre stop. Blank/absent => null => the brand is a SOLID
  // (the default). A non-blank value must be a valid hex; an equal value is
  // normalized to null so a solid never persists a redundant second stop.
  const secondaryRaw = (input.brand_color_secondary ?? "").trim();
  let secondary: string | null = null;
  let secondaryOk = true;
  if (secondaryRaw !== "") {
    const s = normalizeHexColor(secondaryRaw);
    if (s == null) {
      secondaryOk = false;
      errors.push("Second brand color must be a valid hex color, or left blank.");
    } else {
      secondary = color != null && s === color ? null : s;
    }
  }

  const logo = validateLogoUrl(input.logo_url);
  if (!logo.ok) {
    errors.push("Logo URL must be a full http(s) link, or left blank.");
  }

  const replyTo = validateReplyToEmail(input.reply_to_email);
  if (!replyTo.ok) {
    errors.push("Reply-to must be a valid email address, or left blank.");
  }

  const delay = validateFeedbackDelayHours(input.feedback_delay_hours);
  if (!delay.ok) {
    errors.push(
      `Feedback delay must be a whole number of hours from 0 to ${MAX_FEEDBACK_DELAY_HOURS}.`,
    );
  }

  if (
    errors.length > 0 ||
    !name.ok ||
    color == null ||
    !secondaryOk ||
    !logo.ok ||
    !replyTo.ok ||
    !delay.ok
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name: name.value,
      brand_color: color,
      brand_color_secondary: secondary,
      logo_url: logo.value,
      reply_to_email: replyTo.value,
      feedback_enabled: input.feedback_enabled !== false,
      feedback_delay_hours: delay.value,
      nurture_enabled: input.nurture_enabled !== false,
      // SMS is OPT-IN: off unless the operator explicitly turns it on.
      sms_enabled: input.sms_enabled === true,
    },
  };
}
