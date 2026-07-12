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
