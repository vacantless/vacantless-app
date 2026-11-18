// ============================================================================
// lib/application-offer: pure model for the offer step (S816).
// Noam 2026-11-17: "is it easy ... to send a renter ... an offer?" -> the
// landlord sends rent, deposit, start date and conditions; every applicant
// signs with their typed name; when the last one signs the offer is accepted
// and "Start the tenancy" opens prefilled. No I/O here.
// ============================================================================

export type OfferStatus = "sent" | "accepted" | "declined" | "withdrawn";

export type OfferInput = {
  rent: string;
  deposit: string;
  startDate: string;
  termMonths: string;
  conditions: string;
  landlordName: string;
};

export type OfferParsed = {
  rent_cents: number;
  deposit_cents: number | null;
  start_date: string;
  term_months: number | null;
  conditions: string | null;
  landlord_signed_name: string;
};

/** "$1,250.50" -> 125050; blank -> null; bad -> NaN. */
export function dollarsToCents(raw: string | null | undefined): number | null {
  const s = (raw ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

export function parseOfferInput(
  input: OfferInput,
): { ok: true; value: OfferParsed } | { ok: false; reason: string } {
  const rent = dollarsToCents(input.rent);
  if (rent == null || Number.isNaN(rent) || rent <= 0) return { ok: false, reason: "rent" };
  const deposit = dollarsToCents(input.deposit);
  if (deposit != null && (Number.isNaN(deposit) || deposit < 0)) return { ok: false, reason: "deposit" };
  const start = (input.startDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start + "T00:00:00Z"))) {
    return { ok: false, reason: "start" };
  }
  const termRaw = (input.termMonths ?? "").trim();
  let term: number | null = null;
  if (termRaw) {
    term = Number(termRaw);
    if (!Number.isInteger(term) || term < 1 || term > 60) return { ok: false, reason: "term" };
  }
  const landlord = (input.landlordName ?? "").trim();
  if (landlord.replace(/\s/g, "").length < 2) return { ok: false, reason: "landlord_name" };
  const conditions = (input.conditions ?? "").trim().slice(0, 2000) || null;
  return {
    ok: true,
    value: {
      rent_cents: rent,
      deposit_cents: deposit,
      start_date: start,
      term_months: term,
      conditions,
      landlord_signed_name: landlord,
    },
  };
}

export const OFFER_ERRORS: Record<string, string> = {
  rent: "Enter the monthly rent.",
  deposit: "The deposit should be a dollar amount, or leave it blank.",
  start: "Pick the start date.",
  term: "The term should be 1 to 60 months, or leave it blank.",
  landlord_name: "Type your name to sign the offer.",
  no_applicants: "Nobody has signed an application yet. An offer goes to the people who applied.",
  open_offer: "An offer is already out. Withdraw it first to send a new one.",
};

export function fmtDollars(cents: number | null | undefined): string {
  if (cents == null) return "-";
  const whole = cents % 100 === 0;
  return (
    "$" +
    (cents / 100).toLocaleString("en-CA", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/** "Starts Dec 1, 2026" in plain words, no timezone drift. */
export function fmtStartDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/** The offer's terms as short lines (used on the page, the email and the record). */
export function offerTermLines(o: {
  rent_cents: number;
  deposit_cents: number | null;
  start_date: string;
  term_months: number | null;
}): string[] {
  const lines = [`Rent: ${fmtDollars(o.rent_cents)} a month`, `Starts: ${fmtStartDate(o.start_date)}`];
  lines.push(o.term_months ? `Term: ${o.term_months} months` : "Term: month to month");
  if (o.deposit_cents != null && o.deposit_cents > 0) lines.push(`Deposit: ${fmtDollars(o.deposit_cents)}`);
  return lines;
}

export function offerStatusLabel(status: string, signed: number, total: number): string {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "withdrawn":
      return "Withdrawn";
    default:
      return total > 1 ? `Sent, ${signed} of ${total} signed` : "Sent, waiting to sign";
  }
}

/** Only a sent offer can be withdrawn; only a declined or withdrawn one lets a new one go out. */
export function canSendNewOffer(latestStatus: string | null | undefined): boolean {
  return latestStatus == null || latestStatus === "declined" || latestStatus === "withdrawn";
}
