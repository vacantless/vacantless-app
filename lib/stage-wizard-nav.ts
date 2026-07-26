// ============================================================================
// Guided distribution wizard navigation (S588). Pure — no DOM / IO.
// Unit-tested (scripts/test-stage-wizard-nav.ts).
//
// Stages 1-2 are org-level; Stages 3-4 are per-listing. When the operator
// enters the wizard for a specific property (?property=<id>), the id must ride
// through every Back/Next hop so the flow stays about that one listing. Callers
// pass the VALIDATED owned property id (never raw user input), so this only ever
// reflects an id the org actually owns.
// ============================================================================

// Append ?property=<id> to a wizard href, preserving any existing query string
// and trailing #hash. Null / blank id -> the href is returned unchanged (the
// org-level fallback).
export function withPropertyParam(
  href: string,
  propertyId: string | null | undefined,
): string {
  const id = propertyId?.trim();
  if (!id) return href;

  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}property=${encodeURIComponent(id)}${hash}`;
}
