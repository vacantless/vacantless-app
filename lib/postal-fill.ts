// S829d: fill a rental's missing postal code. Kijiji only places a rental by
// postal code or a plain street address; 50 Glenrose B had neither a postal
// code nor a geocodable address ("Unit B" in it) and its Location stayed
// empty (KI1752). Pure helpers; the save paths call them (properties/actions).

const CA_POSTAL_RE = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s*(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
const UNIT_SEGMENT_RE = /^(?:unit|suite|apt\.?|apartment|ste\.?|#)\s*[\w-]+$/i;

/** The first Canadian postal code in any of the texts, as "M4T 1K4", else null. */
export function postalFromText(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = CA_POSTAL_RE.exec(t ?? "");
    if (m) return `${m[1]} ${m[2]}`.toUpperCase();
  }
  return null;
}

/** "50 Glenrose Ave, Unit B, Toronto, ON" -> "50 Glenrose Ave, Toronto, ON". */
export function addressWithoutUnit(address: string): string {
  return address
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !UNIT_SEGMENT_RE.test(s))
    .join(", ");
}
