// Resolve the phone a renter texts/calls ON ARRIVAL for a booked viewing (S471).
// Precedence: per-property override -> org default -> org public contact phone.
// Mirrors the SQL in get_booking_confirmation_extras (migration 0136) for the
// server-side reminder path; the anon booking path uses that RPC directly.
export function resolveArrivalPhone(
  propertyPhone: string | null | undefined,
  orgDefaultPhone: string | null | undefined,
  publicContactPhone: string | null | undefined,
): string | null {
  const pick = (v: string | null | undefined): string | null => {
    const s = (v ?? "").trim();
    return s === "" ? null : s;
  };
  return pick(propertyPhone) ?? pick(orgDefaultPhone) ?? pick(publicContactPhone);
}

/**
 * Build the digit string for a tel: link from an operator-entered phone that may
 * carry an extension ("226-778-0014 ext 5", "...x5", "...#5"). Strips formatting
 * to digits/plus and PAUSE-dials any extension (tel:<number>,<ext>) rather than
 * mashing it onto the number. Returns "" for a null/blank phone.
 */
export function telDialString(phone: string | null | undefined): string {
  const s = (phone ?? "").trim();
  if (s === "") return "";
  const m = s.match(/(?:ext\.?|x|#)\s*(\d{1,6})\s*$/i);
  const ext = m ? m[1] : "";
  const base = (m ? s.slice(0, m.index) : s).replace(/[^0-9+]/g, "");
  return ext ? `${base},${ext}` : base;
}
