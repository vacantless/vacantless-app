// Pure, dependency-free model of a rental's listing status. Single source of
// truth shared by the operator status picker, the public RPC display guard
// (migration 0020), the public /r page, the property/list badges, and the
// duplicate action. No Supabase / Next imports, so it is unit-tested directly
// with `npx tsx scripts/test-listing-state.ts` (same discipline as lib/photos).
//
// The DB column is properties.status (text + check constraint). Operators think
// in plain terms (Draft / Live / Paused / Leased); the stored values map:
//   draft       → not yet published; PRIVATE (the public /r link 404s)
//   available   → "Live": PUBLIC + bookable (renters can view + book a showing)
//   paused      → temporarily not accepting; the /r page LOADS but shows the
//                 unit as not currently available (a shared link stays valid)
//   leased      → rented; the /r page LOADS and says it's no longer available
//   off_market  → retired/hidden; PRIVATE (the public /r link 404s)
//
// PUBLIC CONTRACT — these predicates MUST stay in lockstep with migration 0020
// and the S193/0018 gate:
//   bookable / accepts inquiries  : status === 'available'   ← whitelist gate
//                                   (get_public_availability / submit_public_lead
//                                    / book_public_showing all require it)
//   publicly visible on /r        : status NOT IN ('draft', 'off_market')
//                                   (get_public_listing display guard)

export const PROPERTY_STATUSES = [
  "draft",
  "available",
  "paused",
  "leased",
  "off_market",
] as const;

export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

// Plain-language labels the operator sees. "available" is shown as "Live"
// because that is what going public means to a landlord.
const LABELS: Record<PropertyStatus, string> = {
  draft: "Draft",
  available: "Live",
  paused: "Paused",
  leased: "Leased",
  off_market: "Off market",
};

// One-line explanation of what each state does, shown under the status picker
// so an operator knows exactly what a renter will (or won't) see.
const HELP: Record<PropertyStatus, string> = {
  draft: "Private while you finish it. Renters can't see this unit yet.",
  available: "Live. Renters can view the unit and book a viewing online.",
  paused: "Hidden from new renters, but kept so you can relist it later.",
  leased: "Marked rented. The public page tells renters it's no longer available.",
  off_market: "Retired. The public link returns not-found.",
};

// Tailwind pill classes for a status badge on the property + list pages.
const BADGE_CLASS: Record<PropertyStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  available: "bg-green-50 text-green-700",
  paused: "bg-amber-50 text-amber-700",
  leased: "bg-blue-50 text-blue-700",
  off_market: "bg-gray-100 text-gray-500",
};

export function isPropertyStatus(value: unknown): value is PropertyStatus {
  return (
    typeof value === "string" &&
    (PROPERTY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Coerce arbitrary form/DB input to a valid status. Unknown values fall back to
 * the provided default (defaults to "available", matching the column default).
 */
export function normalizePropertyStatus(
  input: string | null | undefined,
  fallback: PropertyStatus = "available",
): PropertyStatus {
  const s = (input ?? "").trim();
  return isPropertyStatus(s) ? s : fallback;
}

export function propertyStatusLabel(status: string): string {
  return (LABELS as Record<string, string>)[status] ?? status;
}

export function propertyStatusHelp(status: string): string {
  return (HELP as Record<string, string>)[status] ?? "";
}

export type StatusBadge = { label: string; className: string };

export function propertyStatusBadge(status: string): StatusBadge {
  return {
    label: propertyStatusLabel(status),
    className:
      (BADGE_CLASS as Record<string, string>)[status] ?? "bg-gray-100 text-gray-600",
  };
}

// ---------------------------------------------------------------------------
// Public-contract predicates. Mirror the SQL gates exactly so the UI, the RPC,
// and the /r page never disagree about what a renter can see or do.
// ---------------------------------------------------------------------------

/** True only for the one state the public ACTION RPCs accept (S193/0018). */
export function isPublicBookable(status: string): boolean {
  return status === "available";
}

/** True when the public /r page should LOAD (draft + off_market 404). */
export function isPubliclyVisible(status: string): boolean {
  return status !== "draft" && status !== "off_market";
}

/** True when the /r page loads but must show a "not available" state. */
export function isVisibleButUnavailable(status: string): boolean {
  return isPubliclyVisible(status) && !isPublicBookable(status);
}
