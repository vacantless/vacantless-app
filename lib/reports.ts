// Pure reporting aggregations for the owner/admin dashboard.
// No DB calls here — callers fetch org-scoped rows (RLS) and pass them in,
// which keeps every function trivially unit-testable.
import { type LeadStatus } from "@/lib/pipeline";
import { isPubliclyVisible } from "@/lib/listing-state";

// ---------------------------------------------------------------------------
// Input row shapes (the lean projections the page selects).
// ---------------------------------------------------------------------------

export type LeadLite = {
  id: string;
  source: string | null;
  status: LeadStatus;
  created_at: string;
  leased_date: string | null;
  property_id: string | null;
};

export type ShowingLite = {
  id: string;
  outcome: string | null;
  scheduled_at: string | null;
  created_at: string;
  property_id: string | null;
};

export type PropertyLite = {
  id: string;
  address: string;
  status: string;
  rent_cents: number | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Pipeline rank: how far a lead has progressed. `lost` is terminal with
// unknown progress, so it ranks 0 (counts only in the total, never as
// "reached a milestone"). This keeps the funnel honest.
// ---------------------------------------------------------------------------

const RANK: Record<LeadStatus, number> = {
  new: 1,
  replied: 2,
  contacted: 3,
  booked: 4,
  showed: 5,
  applied: 6,
  leased: 7,
  lost: 0,
};

export function leadRank(status: string): number {
  return (RANK as Record<string, number>)[status] ?? 0;
}

/** Leads whose current status is at or beyond `minRank`. */
export function reachedCount(leads: LeadLite[], minRank: number): number {
  return leads.filter((l) => leadRank(l.status) >= minRank).length;
}

/** Safe percentage (0 when denominator is 0), rounded to whole percent. */
export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// Time-window filtering (by created_at).
// ---------------------------------------------------------------------------

export type WindowDays = 30 | 90 | 365 | "all";

export const WINDOW_OPTIONS: { value: WindowDays; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "12 months" },
  { value: "all", label: "All time" },
];

export function parseWindow(raw: string | undefined): WindowDays {
  if (raw === "30") return 30;
  if (raw === "90") return 90;
  if (raw === "365") return 365;
  if (raw === "all") return "all";
  return 90; // default
}

export function windowStartMs(window: WindowDays, nowMs: number): number {
  if (window === "all") return 0;
  return nowMs - window * 24 * 60 * 60 * 1000;
}

function inWindow(createdAt: string, startMs: number): boolean {
  return new Date(createdAt).getTime() >= startMs;
}

export function filterByWindow<T extends { created_at: string }>(
  rows: T[],
  startMs: number,
): T[] {
  return rows.filter((r) => inWindow(r.created_at, startMs));
}

// ---------------------------------------------------------------------------
// Funnel: total leads → contacted → booked → showed → leased.
// ---------------------------------------------------------------------------

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  ofTotal: number; // % of total leads
  ofPrev: number; // % of the previous step
};

export function buildFunnel(leads: LeadLite[]): FunnelStep[] {
  const total = leads.length;
  const steps: { key: string; label: string; minRank: number }[] = [
    { key: "leads", label: "Inquiries", minRank: 0 }, // all inquiries, incl. lost
    { key: "contacted", label: "Contacted", minRank: 3 },
    { key: "booked", label: "Booked", minRank: 4 },
    { key: "showed", label: "Showed", minRank: 5 },
    { key: "leased", label: "Leased", minRank: 7 },
  ];
  let prev = total;
  return steps.map((s) => {
    const count = reachedCount(leads, s.minRank);
    const step: FunnelStep = {
      key: s.key,
      label: s.label,
      count,
      ofTotal: pct(count, total),
      ofPrev: pct(count, prev),
    };
    prev = count;
    return step;
  });
}

// ---------------------------------------------------------------------------
// By channel (lead source).
// ---------------------------------------------------------------------------

export const UNKNOWN_SOURCE = "Direct / unknown";

export type ChannelRow = {
  source: string;
  leads: number;
  booked: number;
  showed: number;
  leased: number;
  leaseRate: number; // leased / leads, %
};

export function buildChannelReport(leads: LeadLite[]): ChannelRow[] {
  const map = new Map<string, LeadLite[]>();
  for (const l of leads) {
    const key = (l.source ?? "").trim() || UNKNOWN_SOURCE;
    const arr = map.get(key);
    if (arr) arr.push(l);
    else map.set(key, [l]);
  }
  const rows: ChannelRow[] = [];
  for (const [source, group] of map) {
    rows.push({
      source,
      leads: group.length,
      booked: reachedCount(group, 4),
      showed: reachedCount(group, 5),
      leased: reachedCount(group, 7),
      leaseRate: pct(reachedCount(group, 7), group.length),
    });
  }
  // Most leads first, then alphabetical for ties.
  rows.sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
  return rows;
}

// ---------------------------------------------------------------------------
// By property.
// ---------------------------------------------------------------------------

export type PropertyRow = {
  id: string;
  address: string;
  status: string;
  rentCents: number | null;
  leads: number;
  showings: number;
  booked: number;
  leased: number;
};

export function buildPropertyReport(
  properties: PropertyLite[],
  leads: LeadLite[],
  showings: ShowingLite[],
): PropertyRow[] {
  const leadsByProp = new Map<string, LeadLite[]>();
  for (const l of leads) {
    if (!l.property_id) continue;
    const arr = leadsByProp.get(l.property_id);
    if (arr) arr.push(l);
    else leadsByProp.set(l.property_id, [l]);
  }
  const showCountByProp = new Map<string, number>();
  for (const s of showings) {
    if (!s.property_id) continue;
    showCountByProp.set(
      s.property_id,
      (showCountByProp.get(s.property_id) ?? 0) + 1,
    );
  }
  const rows = properties.map((p) => {
    const g = leadsByProp.get(p.id) ?? [];
    return {
      id: p.id,
      address: p.address,
      status: p.status,
      rentCents: p.rent_cents,
      leads: g.length,
      showings: showCountByProp.get(p.id) ?? 0,
      booked: reachedCount(g, 4),
      leased: reachedCount(g, 7),
    };
  });
  rows.sort((a, b) => b.leads - a.leads || a.address.localeCompare(b.address));
  return rows;
}

/**
 * Whether a rental belongs in the "By rental" performance table. Never-public
 * rentals (Draft / Off market) with no activity in the window are dropped so an
 * operator's in-progress drafts don't clutter the report. A private rental that
 * DID gather activity (inquiries or viewings) is kept — real numbers are never
 * hidden. Publicly-visible rentals (Live / Paused / Leased) always qualify.
 */
export function isReportableRental(row: PropertyRow): boolean {
  if (isPubliclyVisible(row.status)) return true;
  return row.leads > 0 || row.showings > 0;
}

/** Drop inactive never-public rentals from a built By-rental report. */
export function filterReportableProperties(rows: PropertyRow[]): PropertyRow[] {
  return rows.filter(isReportableRental);
}

// ---------------------------------------------------------------------------
// Showings outcomes.
// ---------------------------------------------------------------------------

export type ShowingReport = {
  total: number;
  attended: number;
  noShow: number;
  cancelled: number;
  scheduled: number;
  upcoming: number; // scheduled and in the future
  autoClosed: number; // S546: passed showings the system closed with no recorded outcome
  // attendance among shows that actually happened or were missed:
  attendanceRate: number; // attended / (attended + noShow), %
};

export function buildShowingReport(
  showings: ShowingLite[],
  nowMs: number,
): ShowingReport {
  let attended = 0;
  let noShow = 0;
  let cancelled = 0;
  let scheduled = 0;
  let upcoming = 0;
  let autoClosed = 0;
  for (const s of showings) {
    switch (s.outcome) {
      case "attended":
        attended++;
        break;
      case "no_show":
        noShow++;
        break;
      case "cancelled":
        cancelled++;
        break;
      case "auto_closed":
        autoClosed++;
        break;
      case "scheduled":
        scheduled++;
        if (s.scheduled_at && new Date(s.scheduled_at).getTime() >= nowMs)
          upcoming++;
        break;
      default:
        break;
    }
  }
  return {
    total: showings.length,
    attended,
    noShow,
    cancelled,
    scheduled,
    upcoming,
    autoClosed,
    // Auto-closed showings are deliberately excluded: we never learned whether
    // the renter attended, so counting them would distort the rate.
    attendanceRate: pct(attended, attended + noShow),
  };
}

// ---------------------------------------------------------------------------
// Time-to-lease: average days from created_at to leased_date for leads that
// leased and have a leased_date recorded.
// ---------------------------------------------------------------------------

export type LeaseTiming = {
  leasedCount: number;
  withDate: number;
  avgDays: number | null; // null when no dated leases
};

export function averageKnownDays(
  days: readonly (number | null | undefined)[],
): { averageDays: number | null; sampleSize: number } {
  const known = days.filter(
    (d): d is number => typeof d === "number" && Number.isFinite(d),
  );
  if (known.length === 0) return { averageDays: null, sampleSize: 0 };
  const sum = known.reduce((n, d) => n + Math.max(0, d), 0);
  return {
    averageDays: Math.round(sum / known.length),
    sampleSize: known.length,
  };
}

// ---------------------------------------------------------------------------
// Post-showing feedback (M5): response volume + average rating + the 1–5 star
// distribution, over the feedback rows in the window.
// ---------------------------------------------------------------------------

export type FeedbackLite = {
  rating: number | null;
  created_at: string;
};

export type FeedbackReport = {
  responses: number;
  avgRating: number | null; // rounded to 1 decimal; null when no rated responses
  distribution: [number, number, number, number, number]; // counts for 1..5
};

export function buildFeedbackReport(feedback: FeedbackLite[]): FeedbackReport {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  let rated = 0;
  for (const f of feedback) {
    const r = f.rating;
    if (r != null && Number.isInteger(r) && r >= 1 && r <= 5) {
      distribution[r - 1]++;
      sum += r;
      rated++;
    }
  }
  return {
    responses: feedback.length,
    avgRating: rated === 0 ? null : Math.round((sum / rated) * 10) / 10,
    distribution,
  };
}

export function buildLeaseTiming(leads: LeadLite[]): LeaseTiming {
  const leased = leads.filter((l) => l.status === "leased");
  const dated = leased.filter((l) => l.leased_date);
  if (dated.length === 0) {
    return { leasedCount: leased.length, withDate: 0, avgDays: null };
  }
  const DAY = 24 * 60 * 60 * 1000;
  const timing = averageKnownDays(
    dated.map((l) => {
      const start = new Date(l.created_at).getTime();
      const end = new Date(l.leased_date as string).getTime();
      return (end - start) / DAY;
    }),
  );
  return {
    leasedCount: leased.length,
    withDate: dated.length,
    avgDays: timing.averageDays,
  };
}
