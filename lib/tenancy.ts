// Pure tenancy domain model (no I/O) so it can be unit-tested in isolation.
//
// A tenancy is the post-lease PROPERTY-MANAGEMENT record: one unit + 1..3
// tenants (co-tenants / roommates) + the signed rent + dates + status. It is
// the foundation both rent collection (Rotessa) and tenant communications build
// on (the product previously stopped at the "leased" lead stage). See migration
// 0028 for the schema. The primary tenant is the future Rotessa payer, so every
// tenancy carries exactly one primary among its tenants.

export const TENANCY_STATUSES = ["upcoming", "active", "ended"] as const;
export type TenancyStatus = (typeof TENANCY_STATUSES)[number];

const STATUS_LABELS: Record<TenancyStatus, string> = {
  upcoming: "Upcoming",
  active: "Active",
  ended: "Ended",
};

export function tenancyStatusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export function isTenancyStatus(value: string): value is TenancyStatus {
  return (TENANCY_STATUSES as readonly string[]).includes(value);
}

// Co-tenants on a single lease. 1 is the common case; 2-3 covers roommates.
export const MAX_TENANTS_PER_TENANCY = 3;

// --- Parsing helpers (mirror the property action parsers) -------------------

/** A dollar string ("1250", "1,250.50") -> integer cents, or null if blank. */
export function parseMoneyToCents(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** A lease-term string -> positive integer months, or null (= month-to-month). */
export function parseTermMonths(raw: string | null | undefined): number | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** An HTML date input ("YYYY-MM-DD") -> the value, or null if malformed/blank. */
export function parseDateOrNull(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// --- Tenant list construction ----------------------------------------------

export type TenantInput = {
  name: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

function clean(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t || null;
}

/**
 * Build a clean tenant list from the form's parallel arrays. Drops fully-empty
 * rows (no name/email/phone), caps at MAX_TENANTS_PER_TENANCY, and guarantees
 * EXACTLY one primary among the surviving rows: the chosen `primaryIndex` if it
 * points at a surviving row, otherwise the first surviving row. Never returns a
 * list with zero or multiple primaries.
 */
export function buildTenantList(input: {
  names: string[];
  emails: string[];
  phones: string[];
  primaryIndex: number;
}): TenantInput[] {
  const { names, emails, phones, primaryIndex } = input;
  const len = Math.max(names.length, emails.length, phones.length);

  // Keep original indices so primaryIndex still resolves after empties drop.
  const surviving: Array<{ origIndex: number; t: TenantInput }> = [];
  for (let i = 0; i < len; i++) {
    const name = clean(names[i]);
    const email = clean(emails[i]);
    const phone = clean(phones[i]);
    if (name == null && email == null && phone == null) continue;
    surviving.push({
      origIndex: i,
      t: { name, email, phone, is_primary: false },
    });
    if (surviving.length >= MAX_TENANTS_PER_TENANCY) break;
  }

  if (surviving.length === 0) return [];

  let primaryPos = surviving.findIndex((s) => s.origIndex === primaryIndex);
  if (primaryPos === -1) primaryPos = 0;
  surviving[primaryPos].t.is_primary = true;

  return surviving.map((s) => s.t);
}

// --- Validation -------------------------------------------------------------

export type TenancyValidation = { ok: true } | { ok: false; code: string };

/**
 * Validate the tenancy create/edit form. Returns a stable error code for the
 * page's `?err=` param. Requires a unit, a start date, at least one tenant with
 * a name, and (if an end date is given) end >= start.
 */
export function validateTenancyInput(v: {
  propertyId: string | null;
  startDate: string | null;
  endDate: string | null;
  tenants: TenantInput[];
}): TenancyValidation {
  if (!v.propertyId) return { ok: false, code: "property" };
  if (!v.startDate) return { ok: false, code: "start" };
  if (v.endDate && v.endDate < v.startDate) return { ok: false, code: "dates" };
  if (!v.tenants.some((t) => t.name != null)) return { ok: false, code: "tenant" };
  return { ok: true };
}

// Human-readable messages for each validation/error code (UI surfaces these).
const ERROR_MESSAGES: Record<string, string> = {
  property: "Pick which rental this tenancy is for.",
  start: "A lease start date is required.",
  dates: "The end date can't be before the start date.",
  tenant: "Add at least one tenant with a name.",
  max: `A tenancy can have at most ${MAX_TENANTS_PER_TENANCY} tenants.`,
  forbidden: "You don't have permission to manage tenancies.",
  // Server-side guardrails (Codex QA, 2026-06-28).
  property_not_found: "That rental couldn't be found in your account.",
  lead_not_found: "That inquiry couldn't be found in your account.",
  lead_mismatch: "That inquiry is for a different rental than the one selected.",
  dup_tenancy:
    "This rental already has an active or upcoming tenancy. End it first, or pick another rental.",
};

export function tenancyErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

/** Format integer cents as a "$1,250/mo" style string (or a dash when null). */
export function formatRentCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString()}`;
}
