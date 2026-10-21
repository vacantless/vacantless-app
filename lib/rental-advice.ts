// rental-advice.ts (S727). Plain advice per rental, from this landlord's own
// enquiries: which listed rental is lagging the others, and which one gets
// interest but no bookings. Pure and rule based, like posting-advice.ts, so
// every line can be checked against the numbers. Too little data, no advice.
//
// Why a fixed two-week look-back and not the Reports window: rentals go on
// the market at different times, so a 90-day count compares a new ad with an
// old one. Each rental's enquiries are counted over the last 14 days (or since
// it was listed, if later) and turned into a per-week rate.
import { leadRank, type LeadLite } from "./reports";

export const LOOKBACK_DAYS = 14;
/** A rental listed for less than this is too new to judge. */
export const MIN_DAYS_LISTED = 7;
/** The other rentals must average at least this many enquiries a week. */
export const MIN_OTHERS_PER_WEEK = 2;
/** "Lagging" means at most a third of the others' typical rate. */
export const SLOW_RATIO = 1 / 3;
/** Enquiries with no booking before we call it out. */
export const NO_BOOKING_MIN = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RentalLite = {
  id: string;
  address: string;
  status: string;
  created_at: string;
  available_since?: string | null;
};

export type RentalAdvice = { tone: "good" | "fix"; text: string; propertyId: string };

/** "833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4" reads "833 Pillette Rd, Unit 3". */
export function shortAddress(address: string): string {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return address.trim();
  if (parts.length > 1 && /^(unit|suite|apt|apartment|#)/i.test(parts[1])) {
    return `${parts[0]}, ${parts[1]}`;
  }
  return parts[0];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function roundRate(x: number): number {
  return x >= 10 ? Math.round(x) : Math.round(x * 2) / 2;
}

export type RentalRate = {
  id: string;
  label: string;
  days: number;
  enquiries: number;
  booked: number;
  perWeek: number;
};

export function rentalRates(rentals: RentalLite[], leads: LeadLite[], nowMs: number): RentalRate[] {
  const out: RentalRate[] = [];
  for (const r of rentals) {
    if (r.status !== "available") continue;
    const since = Date.parse(r.available_since ?? r.created_at);
    if (!Number.isFinite(since)) continue;
    const daysListed = (nowMs - since) / DAY_MS;
    if (daysListed < MIN_DAYS_LISTED) continue;
    const days = Math.min(LOOKBACK_DAYS, daysListed);
    const fromMs = nowMs - days * DAY_MS;
    const mine = leads.filter(
      (l) => l.property_id === r.id && Date.parse(l.created_at) >= fromMs && Date.parse(l.created_at) <= nowMs,
    );
    out.push({
      id: r.id,
      label: shortAddress(r.address),
      days: Math.round(days),
      enquiries: mine.length,
      booked: mine.filter((l) => leadRank(l.status) >= 4).length,
      perWeek: (mine.length / days) * 7,
    });
  }
  return out;
}

export function buildRentalAdvice(rentals: RentalLite[], leads: LeadLite[], nowMs: number): RentalAdvice[] {
  const rates = rentalRates(rentals, leads, nowMs);
  if (rates.length < 2) return [];
  const out: RentalAdvice[] = [];

  const slow: RentalRate[] = [];
  for (const r of rates) {
    const others = median(rates.filter((x) => x.id !== r.id).map((x) => x.perWeek));
    if (others >= MIN_OTHERS_PER_WEEK && r.perWeek <= others * SLOW_RATIO) slow.push(r);
  }
  slow.sort((a, b) => a.perWeek - b.perWeek);
  for (const r of slow.slice(0, 2)) {
    const others = median(rates.filter((x) => x.id !== r.id).map((x) => x.perWeek));
    out.push({
      tone: "fix",
      propertyId: r.id,
      text:
        `${r.label} got ${plural(r.enquiries, "inquiry", "inquiries")} in the last ${r.days} days. ` +
        `Your other rentals get about ${roundRate(others)} a week. ` +
        `A slow ad is usually the rent or the first photo: try a photo of the building or the brightest room first, and compare the rent with similar ads.`,
    });
  }

  const unbooked = rates
    .filter((r) => r.enquiries >= NO_BOOKING_MIN && r.booked === 0 && !slow.includes(r))
    .sort((a, b) => b.enquiries - a.enquiries)[0];
  if (unbooked) {
    out.push({
      tone: "fix",
      propertyId: unbooked.id,
      text:
        `${unbooked.label} got ${plural(unbooked.enquiries, "inquiry", "inquiries")} in the last ${unbooked.days} days but no viewing booked. ` +
        `Check that you have viewing times open for it and that its ads link to its booking page.`,
    });
  }

  const best = [...rates].sort((a, b) => b.perWeek - a.perWeek)[0];
  if (slow.length > 0 && best && best.perWeek >= MIN_OTHERS_PER_WEEK && !slow.includes(best)) {
    out.push({
      tone: "good",
      propertyId: best.id,
      text: `${best.label} gets the most interest: ${plural(best.enquiries, "inquiry", "inquiries")} in the last ${best.days} days. What its ad does well (price, first photo, title) is worth copying.`,
    });
  }

  return out.slice(0, 3);
}
