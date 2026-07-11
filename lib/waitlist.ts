// ============================================================================
// lib/waitlist.ts — pure helpers for the waiting list (S457).
//
// No IO. Powers three sites: the public join form (parse/validate a submission),
// the operator manage surface (status labels, preference summary), and the
// "Notify waitlist" match (does a now-available property match a waiting entry).
// Kept pure + exhaustively unit-tested (scripts/test-waitlist.ts) so the wiring
// layers stay thin.
// ============================================================================

// ---- Status lifecycle ------------------------------------------------------

export const WAITLIST_STATUSES = ["active", "converted", "removed"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export function isWaitlistStatus(v: string): v is WaitlistStatus {
  return (WAITLIST_STATUSES as readonly string[]).includes(v);
}

export function waitlistStatusLabel(v: string | null | undefined): string {
  switch ((v ?? "").trim()) {
    case "active":
      return "Waiting";
    case "converted":
      return "Converted";
    case "removed":
      return "Removed";
    default:
      return "Waiting";
  }
}

// ---- Parse / normalize a submission ---------------------------------------

/** Trim + lowercase an email, or null if blank / obviously invalid (no "@"). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  // Minimal shape check: something@something with no spaces. The renter's email
  // is not authenticated here (same posture as a lead), so this only rejects
  // obvious junk, not deliverability.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

/** The digits of a phone, or "" if none. */
function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/**
 * Best-effort NANP E.164 (+1XXXXXXXXXX). Accepts 10 digits, or 11 leading with
 * a country "1"; anything else is null (the raw phone is stored separately). The
 * SQL RPC uses the same rule so the client hint and the server agree.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  let d = phoneDigits(raw);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `+1${d}` : null;
}

/** A trimmed phone string, or null if blank. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v ? v : null;
}

/** A non-negative integer parsed from a string, else null. */
export function parseBeds(raw: string | null | undefined): number | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : null;
}

/**
 * Parse a rent string ("$1,500", "1500", "1,500/mo") to CENTS, else null.
 * Accepts a plain dollar amount; ignores currency symbols, commas, and a
 * trailing "/mo". Rejects negatives and absurd values.
 */
export function parseRentToCents(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[^0-9.]/g, "").trim();
  if (!v) return null;
  const dollars = Number.parseFloat(v);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) return null;
  return Math.round(dollars * 100);
}

/** 'YYYY-MM-DD' or null if blank / malformed. */
export function parseDateOrNull(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** A waiting entry needs at least one reachable channel. */
export function hasReachableContact(input: {
  email?: string | null;
  phone?: string | null;
}): boolean {
  return normalizeEmail(input.email) != null || normalizePhone(input.phone) != null;
}

// ---- Preference summary (display) -----------------------------------------

export type WaitlistPreferences = {
  beds_min: number | null;
  max_rent_cents: number | null;
  move_in_by: string | null;
};

/** A short human line describing an entry's preferences, or "" if none set. */
export function preferenceSummary(p: WaitlistPreferences): string {
  const parts: string[] = [];
  if (p.beds_min != null) parts.push(`${p.beds_min}+ bed${p.beds_min === 1 ? "" : "s"}`);
  if (p.max_rent_cents != null) {
    parts.push(`up to $${Math.round(p.max_rent_cents / 100).toLocaleString("en-US")}/mo`);
  }
  if (p.move_in_by && p.move_in_by.trim()) parts.push(`by ${p.move_in_by.trim()}`);
  return parts.join(" · ");
}

// ---- Vacancy matching ------------------------------------------------------

export type VacancyProperty = {
  id: string;
  status: string | null;
  beds: number | null;
  rent_cents: number | null;
};

export type WaitlistMatchEntry = {
  status: string | null;
  property_id: string | null;
  beds_min: number | null;
  max_rent_cents: number | null;
  last_notified_property_id: string | null;
};

/**
 * Does a now-available property match a waiting entry? True only when:
 *   - the entry is still active,
 *   - the property is actually 'available',
 *   - the entry is org-wide (property_id null) OR tied to THIS property,
 *   - it hasn't already been notified about THIS property (idempotency),
 *   - and any set preference is satisfied. A preference is only ENFORCED when it
 *     is known on BOTH sides — an unknown property bed count / rent never
 *     silently excludes a waiter (better to over-notify than to drop a match).
 */
export function matchesVacancy(
  entry: WaitlistMatchEntry,
  property: VacancyProperty,
): boolean {
  if ((entry.status ?? "") !== "active") return false;
  if ((property.status ?? "") !== "available") return false;

  if (entry.property_id && entry.property_id !== property.id) return false;

  if (
    entry.last_notified_property_id &&
    entry.last_notified_property_id === property.id
  ) {
    return false;
  }

  if (
    entry.beds_min != null &&
    property.beds != null &&
    property.beds < entry.beds_min
  ) {
    return false;
  }

  if (
    entry.max_rent_cents != null &&
    property.rent_cents != null &&
    property.rent_cents > entry.max_rent_cents
  ) {
    return false;
  }

  return true;
}

/** Filter a list of entries to those matching the given available property. */
export function matchingEntries<T extends WaitlistMatchEntry>(
  entries: readonly T[],
  property: VacancyProperty,
): T[] {
  return entries.filter((e) => matchesVacancy(e, property));
}
