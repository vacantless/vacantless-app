// ============================================================================
// Address + unit split. Lifted out of lib/listing-fill-sheet.ts in S695 when the
// per-portal fill sheet was removed (DECISION-S694): seven non-syndication
// callers (expenses, maintenance, reconcile, standard policy, building notices,
// rent roll, statements) only ever wanted this one function. Pure, no IO.
// Tests: scripts/test-address-unit.ts.
// ============================================================================

/** Trimmed free-text value, or null when blank. */
function textOrNull(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const v = s.trim();
  return v || null;
}

/**
 * Split a combined address string into the street address and a separate unit /
 * suite number (S264 finding #2: Rentals.ca has distinct Address + Unit fields,
 * but our `address` is one string). Recognizes "Unit 808", "Suite 12B",
 * "Apt 4", "Apartment 4", "Ste 9", and "#808" anywhere in the string, strips
 * that segment (and its adjoining comma) out of the street value, and tidies the
 * leftover comma/space artifacts. When no unit token is present the street is
 * returned unchanged and unit is null (a genuinely unit-less address).
 *
 * An immediately-following parenthetical alias is treated as part of the same
 * unit designation, so "Unit 1 (Main)" strips whole (S433, mirrors the SQL
 * building_key() change in migration 0112) — this is what collapses a triplex
 * entered as "…, Unit 1 (Main), …" / "…, Unit 2 (Upper), …" onto one building
 * label. A STANDALONE parenthetical with no unit token ("123 Main St (North
 * Tower)") is left intact so genuinely distinct buildings never merge.
 */
export function splitAddressUnit(address: string | null | undefined): {
  street: string | null;
  unit: string | null;
} {
  const raw = textOrNull(address);
  if (!raw) return { street: null, unit: null };
  // Match an optional leading comma/space, then a unit designator, then the
  // unit token, then an OPTIONAL adjacent "(...)" alias. `unit|suite|ste|apt|
  // apartment` need word boundaries; `#` is punctuation so it stands alone.
  const re =
    /[,\s]*(?:\b(?:unit|suite|ste|apt|apartment)\b\.?|#)\s*([A-Za-z0-9-]+)(?:\s*\([^)]*\))?/i;
  const m = re.exec(raw);
  if (!m) return { street: raw, unit: null };
  const unit = m[1];
  let street = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
  street = street
    .replace(/\s*,(?:\s*,)+\s*/g, ", ") // collapse doubled commas
    .replace(/^\s*,\s*/, "") // strip a leading comma
    .replace(/\s*,\s*$/, "") // strip a trailing comma
    .replace(/\s{2,}/g, " ")
    .trim();
  return { street: street || null, unit };
}
