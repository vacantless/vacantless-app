// Pure scheduling logic for the SEASONAL compliance calendar (S343 — the first
// build-out of the send-mode axis after the S341 approve_to_send keystone). NO
// DB / env / I/O here so it unit-tests cleanly via
// `npx tsx scripts/test-compliance-calendar.ts`. The impure pieces (per-org
// tenancy queries, the enqueue into pending_tenant_messages) live in
// app/api/cron/compliance-calendar/route.ts; the COPY (subject/body/tokens/
// audience/sendMode) lives in lib/notifications.ts as registered events. This
// module owns only WHEN each seasonal item is due.
//
// The model is intentionally simple for v1: each item recurs ANNUALLY on a fixed
// (month, day) anchor, with a lead window that opens `leadDays` before the anchor
// and stays open through `anchorDay + graceDays`. The cron, on each tick, asks
// dueComplianceItems(today) which items are inside their window, then drafts one
// soft tenant courtesy note per active tenancy (idempotent per season via the
// pending_tenant_messages dedupe key). A quarterly/monthly recurrence and the
// formal LTB-form items (notify-the-landlord) are deliberately out of this slice.
//
// Dates are plain YYYY-MM-DD strings anchored to the org's LOCAL date (the cron
// passes localDateString(now, org.booking_timezone) — the same value the rent-
// increase sweep uses), so the seasonal windows match the operator's calendar
// rather than the UTC server clock (KI443).

// One scheduled seasonal item. eventKey ties to a registered NotificationEvent
// (lib/notifications.ts) for the actual copy; this row is purely the schedule.
export type ComplianceCalendarItem = {
  /** The registered leasing.* event key whose copy this schedule drives. */
  eventKey: string;
  /** Anchor month (1-12) the reminder is built around. */
  anchorMonth: number;
  /** Anchor day-of-month (1-31). */
  anchorDay: number;
  /** Days BEFORE the anchor the draft window opens. */
  leadDays: number;
  /** Days AFTER the anchor the window stays open (default 0). */
  graceDays?: number;
};

// The v1 seasonal set — all SOFT, approve_to_send tenant courtesy notes. Spread
// across the year so the calendar feels real: a fall cluster (filter / water-off
// / alarm test as the heating season starts) + a spring item (water back on).
// Ontario-appropriate timing; the lead windows are generous so a fortnightly
// glance still catches them. Extend by adding a row here AND registering the
// matching event in lib/notifications.ts — no cron/UI changes needed.
export const COMPLIANCE_CALENDAR_ITEMS: readonly ComplianceCalendarItem[] = [
  // Heating season begins — change the furnace filter.
  { eventKey: "leasing.seasonal_furnace_filter", anchorMonth: 10, anchorDay: 1, leadDays: 14, graceDays: 7 },
  // Before first frost — winterize the outdoor faucets.
  { eventKey: "leasing.seasonal_water_shutoff", anchorMonth: 10, anchorDay: 20, leadDays: 21, graceDays: 7 },
  // Start of heating season / clocks change — test smoke + CO alarms.
  { eventKey: "leasing.seasonal_smoke_co_test", anchorMonth: 11, anchorDay: 1, leadDays: 14, graceDays: 7 },
  // After frost risk passes — outdoor water back on for spring.
  { eventKey: "leasing.seasonal_water_turnon", anchorMonth: 4, anchorDay: 20, leadDays: 21, graceDays: 7 },
  // Deep winter — clear dryer lint/vent (fire safety; fills the Jan–Feb gap).
  { eventKey: "leasing.seasonal_dryer_vent", anchorMonth: 2, anchorDay: 1, leadDays: 14, graceDays: 14 },
  // Before the cooling season — test the AC and swap the filter.
  { eventKey: "leasing.seasonal_ac_startup", anchorMonth: 5, anchorDay: 15, leadDays: 14, graceDays: 7 },
  // After leaf-fall, before winter — clear eavestroughs + downspouts.
  { eventKey: "leasing.seasonal_eavestrough", anchorMonth: 11, anchorDay: 15, leadDays: 14, graceDays: 14 },
] as const;

// --- Date helpers (UTC-anchored on YYYY-MM-DD strings; no TZ drift) -----------

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a YYYY-MM-DD into a UTC-midnight epoch-ms, or null if malformed. */
export function parseYmdUTC(ymd: string): number | null {
  const m = YMD_RE.exec((ymd ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // Reject impossible dates (e.g. 2025-02-30 rolls over) by round-tripping.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

const DAY_MS = 86_400_000;

/** Build the YYYY-MM-DD anchor date for an item in a given calendar year. */
export function anchorDateFor(item: ComplianceCalendarItem, year: number): string {
  const mo = String(item.anchorMonth).padStart(2, "0");
  const d = String(item.anchorDay).padStart(2, "0");
  return `${year}-${mo}-${d}`;
}

// A seasonal item that is due on `today`, with the resolved cycle anchor + year.
export type DueComplianceItem = {
  item: ComplianceCalendarItem;
  /** The calendar year of the matched anchor — the per-season dedupe scope. */
  seasonYear: number;
  /** The matched anchor date (YYYY-MM-DD), for tokens / reporting. */
  anchorDate: string;
};

/**
 * Which seasonal items are inside their draft window on `today` (a local
 * YYYY-MM-DD). Pure. For each item we test the anchor in the previous, current,
 * and next calendar year so a window that straddles Jan 1 still resolves; since
 * every window is far shorter than a year, at most one year matches per item.
 *
 * Window is inclusive: [anchor - leadDays, anchor + graceDays].
 */
export function dueComplianceItems(today: string): DueComplianceItem[] {
  const todayMs = parseYmdUTC(today);
  if (todayMs == null) return [];
  const todayYear = new Date(todayMs).getUTCFullYear();
  const out: DueComplianceItem[] = [];
  for (const item of COMPLIANCE_CALENDAR_ITEMS) {
    for (const year of [todayYear - 1, todayYear, todayYear + 1]) {
      const anchorMs = parseYmdUTC(anchorDateFor(item, year));
      if (anchorMs == null) continue;
      const opensMs = anchorMs - item.leadDays * DAY_MS;
      const closesMs = anchorMs + (item.graceDays ?? 0) * DAY_MS;
      if (todayMs >= opensMs && todayMs <= closesMs) {
        out.push({ item, seasonYear: year, anchorDate: anchorDateFor(item, year) });
        break; // a single item can match at most one year's window
      }
    }
  }
  return out;
}

/**
 * The idempotency key for a seasonal draft so the 15-min cron drafts AT MOST ONE
 * row per (tenancy, event, season). Scoped by the anchor YEAR (the season), so a
 * given seasonal note is drafted once per year per tenancy even though the window
 * is open for weeks. Mirrors the rent-increase tenantNoticeDedupeKey shape.
 */
export function seasonalDedupeKey(
  eventKey: string,
  tenancyId: string,
  seasonYear: number,
): string {
  return `${eventKey}:${tenancyId}:${seasonYear}`;
}
