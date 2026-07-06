// ============================================================================
// Lease extraction - the PURE parse contract for a signed lease -> a structured
// tenancy skeleton (S425, "lease-OCR / PII pass"). The missing front door to the
// money + compliance layer: today every tenancy's start/end/rent/deposit/term is
// hand-keyed; a lease upload pre-fills the New-Tenancy form and the operator just
// confirms. The extraction itself is delegated to a multimodal model in
// lib/lease-extract-vision.ts (the impure, network half); THIS module is the
// deterministic contract around it - the JSON schema the model must return, the
// prompt, the normalizer that clamps every field to the same bounds the manual
// tenancy form enforces, and (critically) the PII redaction guard. No DB / env /
// I/O, so it unit-tests cleanly via `npx tsx scripts/test-lease-extract.ts`.
//
// Mirrors lib/asset-capture.ts on purpose (same pure/impure split, same tolerant
// JSON extraction, same never-guess posture). See LEASE-OCR-EXTRACTION-SPEC-
// 2026-07-06.md for the full design + the review-first flow.
//
// PII POSTURE (the core of this build - three independent layers so no single
// failure ever persists a tenant identifier):
//   Layer 1 (prompt): the model is told to NEVER return SIN/SSN, driver's
//            licence, bank/void-cheque/PAD, card, DOB, or passport numbers.
//   Layer 2 (THIS file, redactPII): every returned string is run through a guard
//            that nulls the whole field if it looks like any of the above,
//            regardless of what the model did - a prompt regression cannot leak.
//   Layer 3 (vision adapter): the lease bytes are sent transiently and NOT
//            persisted; attaching the lease is a separate opt-in document path.
// ============================================================================

// ---------------------------------------------------------------------------
// Bounds (mirror the tenancy form's own clamps in lib/tenancy.ts:: parseMoney /
// parseTermMonths / validateTenancyInput so a scanned draft can never carry a
// value the manual form would reject).
// ---------------------------------------------------------------------------
/** Trim ceiling for any short free-text field the model returns. */
export const MAX_TEXT_LEN = 120;
/** Ceiling for the plain-language clause summary. */
export const MAX_NOTES_LEN = 500;
/** Monthly rent / deposit sanity ceiling, in cents ($100,000/mo). */
export const MAX_MONEY_CENTS = 10_000_000;
/** Lease term bounds, in months (matches the manual form's practical range). */
export const MIN_TERM_MONTHS = 1;
export const MAX_TERM_MONTHS = 600;
/** Calendar-year bounds for a lease date (start/end). */
export const MIN_LEASE_YEAR = 1990;
export const MAX_LEASE_YEAR = 2100;
/** A tenancy carries at most this many tenants (mirror MAX_TENANTS_PER_TENANCY). */
export const MAX_TENANTS = 3;

export const DEPOSIT_TYPES = ["lmr", "security"] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

export const LEASE_TYPES = ["fixed", "month_to_month"] as const;
export type LeaseType = (typeof LEASE_TYPES)[number];

/**
 * An HTTP header value must be an ASCII ByteString. An API key pasted through a
 * notes app can pick up a non-ASCII character (a hyphen autocorrected to an
 * en/em dash, a smart quote), which makes `fetch` throw a raw ByteString
 * TypeError while building the x-api-key header (KI555). Validate up front so a
 * malformed key reads as a config problem, not a transient network failure.
 */
export function isAsciiApiKey(key: string): boolean {
  return key.length > 0 && /^[\x21-\x7E]+$/.test(key);
}

// ---------------------------------------------------------------------------
// The result contract
// ---------------------------------------------------------------------------

/** One party on the lease. Contact identity only (name/email/phone) - the fields
 * needed to create the tenancy's tenant rows. NEVER an identifier (SIN etc.). */
export interface LeaseTenant {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** The structured tenancy skeleton read off a lease. Everything is nullable - a
 * lease may omit a field and the model must null what it cannot read. The clause
 * digest fields describe the PROPERTY's policies (pets/smoking/utilities/parking)
 * and are surfaced for the operator to ratify; see the spec for the property-vs-
 * tenancy boundary. */
export interface LeaseDraft {
  // --- tenancy core (maps 1:1 to the New-Tenancy form) ---
  start_date: string | null; // ISO YYYY-MM-DD
  end_date: string | null; // ISO YYYY-MM-DD (null = month-to-month / open)
  term_months: number | null;
  rent_cents: number | null;
  deposit_cents: number | null;
  deposit_type: DepositType | null;
  lease_type: LeaseType | null;
  tenants: LeaseTenant[];
  // --- match hint (NOT stored; used only to suggest which existing unit) ---
  unit_address: string | null;
  landlord_name: string | null;
  // --- clause digest (pre-filled flags the operator confirms) ---
  pets_allowed: boolean | null;
  smoking_allowed: boolean | null;
  utilities_tenant_pays: string | null;
  parking: string | null;
  rent_due_day: number | null;
  late_fee: string | null;
  notes: string | null;
}

/** The outcome the vision adapter returns. `empty` = parsed but nothing useful
 * was read (all fields null) - the UI should fall back to the manual form. */
export type LeaseParseResult =
  | { ok: true; draft: LeaseDraft }
  | { ok: false; reason: "unconfigured" | "failed" | "empty" | "locked" | "limit" };

// ---------------------------------------------------------------------------
// The prompt (kept here so the contract + wording are versioned together)
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT =
  "You read the first pages of a residential tenancy LEASE (Ontario standard lease " +
  "or similar) that a landlord uploaded, and extract the key terms into structured " +
  "fields. Extract only what is clearly stated. NEVER guess: if a value is absent " +
  "or unclear, use null.\n\n" +
  "CRITICAL PRIVACY RULE: NEVER return, transcribe, or infer any of the following, " +
  "even if they appear on the lease. Leave them out entirely and never place them " +
  "in any field (including name or notes): Social Insurance Number (SIN) or SSN; " +
  "driver's licence number; bank account, transit, or institution numbers; void " +
  "cheque or pre-authorized-debit details; credit-card numbers; date of birth; " +
  "passport or other government ID numbers. Names, emails, and phone numbers of " +
  "the parties ARE allowed (they are needed to set up the tenancy).\n\n" +
  "Reply with ONE JSON object and nothing else - no prose, no markdown fences.";

/** The instruction sent alongside the document/image pages. Describes the exact
 * JSON shape so the model's output maps 1:1 onto normalizeLeaseDraft. */
export function buildExtractionPrompt(): string {
  return [
    "Return a single JSON object with exactly these keys:",
    "",
    '{"start_date":<lease start, YYYY-MM-DD or null>,',
    '"end_date":<fixed-term end, YYYY-MM-DD or null>,',
    '"term_months":<whole months of the term, integer or null>,',
    '"rent_cents":<monthly rent in integer cents, e.g. $1,850.00 -> 185000, or null>,',
    '"deposit_cents":<rent/last-month deposit in integer cents or null>,',
    '"deposit_type":<"lmr" if it is a last-month-rent deposit, "security" if a ' +
      'security/damage deposit, or null>,',
    '"lease_type":<"fixed" if a fixed-term lease, "month_to_month" if periodic, or null>,',
    '"tenants":[{"name":<full name or null>,"email":<email or null>,"phone":<phone or null>}],',
    '"unit_address":<the rented unit\'s address as written, or null>,',
    '"landlord_name":<landlord/agent name or null>,',
    '"pets_allowed":<true/false if the lease states a pet policy, else null>,',
    '"smoking_allowed":<true/false if it states a smoking policy, else null>,',
    '"utilities_tenant_pays":<short text of utilities the tenant pays, e.g. "hydro", or null>,',
    '"parking":<short text describing parking, or null>,',
    '"rent_due_day":<day of month rent is due, 1-31, or null>,',
    '"late_fee":<short text of any late fee, or null>,',
    '"notes":<a plain-language summary (<=500 chars) of any other material clause, or null>}',
    "",
    "Rules: money as INTEGER CENTS. Dates as YYYY-MM-DD. List every tenant named " +
      "on the lease (up to a few). deposit_type/lease_type must be exactly one of " +
      "the listed words or null. Do NOT include any of the forbidden private " +
      "identifiers from the system rule. Output the JSON object only.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tolerant JSON extraction (models sometimes wrap JSON in prose / ``` fences)
// ---------------------------------------------------------------------------

/** Pull the first balanced {...} object out of a model reply and JSON.parse it.
 * Returns null on anything unparseable. Brace-counts so a nested object inside a
 * value doesn't truncate early; string-aware so a brace inside a quoted value is
 * ignored. */
export function extractJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PII redaction guard (Layer 2) - the defense-in-depth heart of the build
// ---------------------------------------------------------------------------

/** Regexes that flag a string as carrying (or labelling) a forbidden identifier.
 * If ANY matches, the whole field is dropped to null - losing a name/note is
 * always preferable to persisting an identifier. These run regardless of the
 * prompt, so a model regression can't leak. */
const PII_PATTERNS: RegExp[] = [
  // Whole-word sensitive-data labels. DOB aliases (birthdate / birth date / born)
  // are included so a labelled value like "Tenant birthdate 1991-05-12" is
  // dropped even when the bare date itself doesn't trip a numeric pattern
  // (Codex QA S425).
  /\b(social insurance|ssn|date of birth|birth\s*-?\s*date|born|d\.?o\.?b\.?|driver'?s?\s*licen[cs]e|void\s*cheque|pre-?authorized\s*debit|bank\s*account|passport)\b/i,
  // Label + a number-ish qualifier. These may END in punctuation ("#"/":"), so
  // they carry NO trailing word-boundary (a `\b` would not hold after "#").
  // Covers "SIN #", "Licence no", "account number", "transit #", "DL:".
  /\b(sin|ssn|licen[cs]e|dl|account|transit|institution)\s*(no|number|#|:)/i,
  // "DL" / "D/L" / "D.L." as a bare driver's-licence abbreviation, with or
  // without slash/dot separators (Codex QA S426b: "D/L A1234-56789",
  // "D.L. A1234-56789", "D/L # ...").
  /\bd[./]?l\b/i,
  // SIN / SSN grouped 9-digit forms: 123-456-789, 123 45 6789, 123456789.
  /\b\d{3}[-\s]?\d{2,3}[-\s]?\d{3,4}\b/,
  // Credit-card-like 13-19 digit runs (allow spaces/dashes between groups).
  /\b(?:\d[ -]?){13,19}\b/,
  // Any bare run of 7+ consecutive digits (account/card/ID numbers). Structured
  // numeric fields (rent_cents, rent_due_day, phone) are parsed separately and
  // never pass through here, so this cannot swallow a legitimate value.
  /\d{7,}/,
];

/** Returns the text unchanged, or null if it trips any PII pattern. Also trims
 * and collapses whitespace and maps model "null"-ish tokens to null. Exported so
 * the tests can assert the boundary directly. */
export function redactPII(v: unknown, maxLen: number = MAX_TEXT_LEN): string | null {
  if (typeof v !== "string") return null;
  const collapsed = v.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  if (/^(null|n\/a|na|none|unknown|unspecified|not stated|-)$/i.test(collapsed)) return null;
  // Run PII detection on the FULL collapsed string BEFORE truncating (Codex QA
  // S425): a near-boundary identifier must not be sliced past the guard, leaving
  // a truncated-but-still-sensitive fragment. Only after the string clears every
  // pattern do we clamp it to the field's length ceiling.
  for (const re of PII_PATTERNS) {
    if (re.test(collapsed)) return null;
  }
  const t = collapsed.slice(0, maxLen).trim();
  return t || null;
}

// ---------------------------------------------------------------------------
// Field coercion helpers (each null-safe; the only logic worth testing)
// ---------------------------------------------------------------------------

function clampInt(v: unknown, min: number, max: number): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, $]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

/** Coerce a model value to an ISO 'YYYY-MM-DD' or null. Accepts an already-ISO
 * string; rejects anything that isn't a real calendar date in-range. */
function cleanIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const yr = Number(y);
  const mon = Number(mo);
  const day = Number(d);
  if (yr < MIN_LEASE_YEAR || yr > MAX_LEASE_YEAR) return null;
  if (mon < 1 || mon > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** Validate an email loosely (one @, a dot in the domain). Runs through the PII
 * guard first so a mis-stuffed identifier can't ride in on the email field. */
function cleanEmail(v: unknown): string | null {
  const t = redactPII(v);
  if (!t) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t.toLowerCase() : null;
}

/** Keep a phone as 10 or 11 digits (NANP), formatted plainly; else null. Does
 * NOT run through redactPII's 7+-digit rule (a phone IS a digit run we want);
 * instead it is strictly shape-checked so nothing but a phone survives. */
function cleanPhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function cleanBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "yes", "allowed", "permitted", "y"].includes(t)) return true;
    if (["false", "no", "not allowed", "prohibited", "n"].includes(t)) return false;
  }
  return null;
}

function cleanEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(t) ? (t as T) : null;
}

/** Coerce a raw tenants value into up to MAX_TENANTS clean {name,email,phone}
 * rows, dropping any row with no usable field. Tolerates a single object. */
function cleanTenants(v: unknown): LeaseTenant[] {
  const arr = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  const out: LeaseTenant[] = [];
  for (const item of arr) {
    if (out.length >= MAX_TENANTS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = redactPII(o.name ?? o.tenant_name ?? o.full_name);
    const email = cleanEmail(o.email);
    const phone = cleanPhone(o.phone ?? o.telephone ?? o.tel);
    if (name || email || phone) out.push({ name, email, phone });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The normalizer - raw model JSON -> a safe, typed LeaseDraft (or null)
// ---------------------------------------------------------------------------

/**
 * Coerce a parsed JSON object into a LeaseDraft, clamping every field to the same
 * bounds the manual tenancy form enforces, running every free-text field through
 * the PII guard, and discarding junk. Returns null only when `raw` isn't an
 * object at all. `term_months` is derived from start+end when the model omitted
 * it but both dates are present.
 */
export function normalizeLeaseDraft(raw: unknown): LeaseDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const start = cleanIsoDate(o.start_date ?? o.lease_start ?? o.start);
  const end = cleanIsoDate(o.end_date ?? o.lease_end ?? o.end);
  let term = clampInt(o.term_months ?? o.term, MIN_TERM_MONTHS, MAX_TERM_MONTHS);
  if (term == null && start && end) {
    const derived = monthsBetween(start, end);
    if (derived != null && derived >= MIN_TERM_MONTHS && derived <= MAX_TERM_MONTHS) {
      term = derived;
    }
  }

  return {
    start_date: start,
    end_date: end,
    term_months: term,
    rent_cents: clampInt(o.rent_cents ?? o.rent, 1, MAX_MONEY_CENTS),
    deposit_cents: clampInt(o.deposit_cents ?? o.deposit, 1, MAX_MONEY_CENTS),
    deposit_type: cleanEnum(o.deposit_type, DEPOSIT_TYPES),
    lease_type: cleanEnum(o.lease_type, LEASE_TYPES),
    tenants: cleanTenants(o.tenants ?? o.tenant),
    unit_address: redactPII(o.unit_address ?? o.address),
    landlord_name: redactPII(o.landlord_name ?? o.landlord),
    pets_allowed: cleanBool(o.pets_allowed),
    smoking_allowed: cleanBool(o.smoking_allowed),
    utilities_tenant_pays: redactPII(o.utilities_tenant_pays ?? o.utilities),
    parking: redactPII(o.parking),
    rent_due_day: clampInt(o.rent_due_day, 1, 31),
    late_fee: redactPII(o.late_fee),
    notes: redactPII(o.notes, MAX_NOTES_LEN),
  };
}

/** Whole calendar months of a lease term, derived when the model omitted it.
 * A lease's end date is the LAST covered day (e.g. Aug 1 2026 -> Jul 31 2027 is a
 * 12-month term), so the next period begins end+1 day; count months from start to
 * that boundary. Null on unparseable input or a non-positive span. */
function monthsBetween(startIso: string, endIso: string): number | null {
  const s = startIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const e = endIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!s || !e) return null;
  const sy = Number(s[1]);
  const sm = Number(s[2]);
  const sd = Number(s[3]);
  // Boundary = end + 1 day (the first uncovered day / start of the next period).
  const boundary = new Date(Date.UTC(Number(e[1]), Number(e[2]) - 1, Number(e[3]) + 1));
  let months = (boundary.getUTCFullYear() - sy) * 12 + (boundary.getUTCMonth() + 1 - sm);
  if (boundary.getUTCDate() < sd) months -= 1;
  return months > 0 ? months : null;
}

/** True when the draft carries nothing useful - the caller should fall back to
 * the manual form rather than open a blank-but-"scanned" one. A draft counts as
 * non-empty if it has any tenancy-core value or at least one tenant. */
export function isEmptyLeaseDraft(d: LeaseDraft): boolean {
  const hasCore =
    d.start_date != null ||
    d.end_date != null ||
    d.term_months != null ||
    d.rent_cents != null ||
    d.deposit_cents != null;
  const hasTenant = d.tenants.length > 0;
  return !hasCore && !hasTenant;
}
