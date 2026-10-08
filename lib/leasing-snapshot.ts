// Pure domain logic for the `leasing.daily_snapshot` digest — the scheduled
// "today's leasing snapshot" email that RETIRES Agile's old daily Zap
// (365197456 / zap-m2-v3-draft.py). NO DB / env / I/O here so it unit-tests
// cleanly via `npx tsx scripts/test-leasing-snapshot.ts`. The impure pieces (the
// per-org snapshot queries, the once-per-day stamp, and the send) live in
// app/api/cron/leasing-snapshot/route.ts; the copy/recipients/branding ride the
// notification substrate (lib/notifications*) exactly like every other event.
//
// The four buckets mirror the deployed Zap's NEUTRAL snapshot (a status view,
// not an alarm), keyed only off reliably-written signals:
//   1) NEW LEADS — last 24h           (leads.created_at within 24h)
//   2) SHOWINGS TODAY                 (showings.scheduled_at in [today, tomorrow))
//   3) SHOWINGS LATER THIS WEEK       (showings.scheduled_at in [tomorrow, +7d))
//   4) CAME IN THIS WEEK, NO SHOWING  (leads 1–7d old, early stage, no booked showing)
// All time math is anchored to the ORG's local timezone (booking_timezone), so
// "today" / "this week" / "start of shift" match the operator's day, not UTC.

import type { LeasingHealth, LeasingHealthStatus } from "./leasing-health";
import type { ListingHealthSnapshotSummary } from "./listing-health";

// --- Row shapes the route passes in (already fetched + flattened) ------------
export type SnapshotLead = {
  name: string | null;
  phone: string | null;
  move_in: string | null; // 'YYYY-MM-DD' or null
  source: string | null;
  property_address: string | null;
  created_at: string | null; // ISO; used only for sort
};

export type SnapshotShowing = {
  name: string | null; // the lead's name
  phone: string | null;
  scheduled_at: string | null; // ISO
  property_address: string | null;
};

export type SnapshotBuckets = {
  newLeads: SnapshotLead[];
  showingsToday: SnapshotShowing[];
  showingsWeek: SnapshotShowing[];
  noShowing: SnapshotLead[];
};

// Per-section cap so a runaway day can't produce a 10,000-line email; the
// overflow shows as "…and N more".
export const SNAPSHOT_SECTION_CAP = 50;

// The lead stages still worth a "no showing yet" nudge. Once a lead is booked /
// showed / applied / leased / lost it's out of the nudge bucket (it's already
// progressed or closed), matching the Zap's NOT_CLOSED guard.
export const SNAPSHOT_NUDGE_STATUSES = ["new", "replied", "contacted"] as const;

// --- Timezone-anchored window ------------------------------------------------

type TzParts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

// Wall-clock components of `ms` in `tz`, via Intl (no tz library). en-CA gives
// stable numeric parts. Falls back to UTC parts if the runtime rejects the tz.
function tzParts(ms: number, tz: string): TzParts {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const map: Record<string, number> = {};
    for (const p of fmt.formatToParts(new Date(ms))) {
      if (p.type !== "literal") map[p.type] = Number(p.value);
    }
    // Intl can emit hour "24" at midnight; normalize to 0.
    const h = map.hour === 24 ? 0 : map.hour;
    return { y: map.year, mo: map.month, d: map.day, h, mi: map.minute, s: map.second };
  } catch {
    const dt = new Date(ms);
    return {
      y: dt.getUTCFullYear(),
      mo: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      h: dt.getUTCHours(),
      mi: dt.getUTCMinutes(),
      s: dt.getUTCSeconds(),
    };
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' for the org-local calendar date of `ms`. */
export function localDateString(ms: number, tz: string): string {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
}

/** Org-local hour 0–23 of `ms`. */
export function localHour(ms: number, tz: string): number {
  return tzParts(ms, tz).h;
}

/** 0=Sun … 6=Sat for the org-local calendar date of `ms`. */
export function localWeekday(ms: number, tz: string): number {
  const p = tzParts(ms, tz);
  return new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
}

export type SnapshotWindow = {
  startTodayIso: string;
  endTodayIso: string;
  endWeekIso: string;
  cutoff24hIso: string;
  cutoff7dIso: string;
  localDate: string; // 'YYYY-MM-DD' local
};

const DAY_MS = 24 * 3_600_000;

/**
 * The five UTC instants the bucket queries need, derived from the org's LOCAL
 * midnight. start/end-today bound "today" in the operator's timezone; end-week
 * is local-midnight + 7 days; the cutoffs are rolling 24h / 7d windows. Pure.
 */
export function snapshotWindow(nowMs: number, tz: string): SnapshotWindow {
  const p = tzParts(nowMs, tz);
  // The UTC instant that is local-midnight today: take the wall date as-if-UTC,
  // then back out the tz offset (asUTC - now == offset of local ahead of UTC).
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  const offsetMs = asUTC - Math.floor(nowMs / 1000) * 1000;
  const startTodayMs = Date.UTC(p.y, p.mo - 1, p.d) - offsetMs;
  return {
    startTodayIso: new Date(startTodayMs).toISOString(),
    endTodayIso: new Date(startTodayMs + DAY_MS).toISOString(),
    endWeekIso: new Date(startTodayMs + 7 * DAY_MS).toISOString(),
    cutoff24hIso: new Date(nowMs - DAY_MS).toISOString(),
    cutoff7dIso: new Date(nowMs - 7 * DAY_MS).toISOString(),
    localDate: `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`,
  };
}

// --- Send gate (once per weekday, at/after the org's start-of-shift hour) -----

export type SnapshotGate = { send: boolean; reason: string; localDate: string };

/**
 * Decide whether to send the snapshot for one org on this cron tick. The route
 * pings every 15 min (the shared GitHub Actions sweep), so this self-gates to
 * exactly once per weekday at/after the org's local snapshot hour, idempotent
 * via the org's `leasing_snapshot_last_sent_on` stamp. Pure + tested.
 *   - weekend (when weekdaysOnly) -> skip
 *   - already sent today (local)  -> skip
 *   - before the local hour       -> skip (wait for start of shift)
 *   - otherwise                   -> send
 */
export function shouldSendSnapshot(args: {
  nowMs: number;
  tz: string;
  snapshotHour: number;
  lastSentOn: string | null;
  weekdaysOnly?: boolean;
}): SnapshotGate {
  const localDate = localDateString(args.nowMs, args.tz);
  const weekdaysOnly = args.weekdaysOnly !== false;
  const dow = localWeekday(args.nowMs, args.tz);
  if (weekdaysOnly && (dow === 0 || dow === 6)) {
    return { send: false, reason: "weekend", localDate };
  }
  if (args.lastSentOn && args.lastSentOn === localDate) {
    return { send: false, reason: "already_sent", localDate };
  }
  if (localHour(args.nowMs, args.tz) < args.snapshotHour) {
    return { send: false, reason: "before_hour", localDate };
  }
  return { send: true, reason: "due", localDate };
}

// --- Counts + content gate ---------------------------------------------------

export type SnapshotCounts = {
  newCount: number;
  showingsTodayCount: number;
  showingsWeekCount: number;
  noShowingCount: number;
};

export function snapshotCounts(b: SnapshotBuckets): SnapshotCounts {
  return {
    newCount: b.newLeads.length,
    showingsTodayCount: b.showingsToday.length,
    showingsWeekCount: b.showingsWeek.length,
    noShowingCount: b.noShowing.length,
  };
}

/**
 * True when ANY bucket has a row — the "fire-on-data" gate. An org running no
 * leasing pipeline (or a quiet day) produces an empty snapshot and gets NO
 * email, so the digest never spams. The route still stamps the day so it
 * doesn't re-check until tomorrow.
 */
export function snapshotHasContent(
  b: SnapshotBuckets,
  health?: LeasingHealth | null,
  listingHealth?: ListingHealthSnapshotSummary | null,
): boolean {
  // S701c: viewing-calendar health no longer forces a send. Agile opens
  // times one day at a time on purpose, so "offline" was noise every day;
  // the weekly availability alert (S700l) covers an empty calendar.
  void health;
  return (
    (listingHealth?.adCount ?? 0) > 0 ||
    b.newLeads.length > 0 ||
    b.showingsToday.length > 0 ||
    b.showingsWeek.length > 0 ||
    b.noShowing.length > 0
  );
}

// --- Formatting (plain text for the substrate's branded shell) ---------------
// The branded notification shell (lib/email.ts notificationHtml -> bodyToParagraphs)
// escapes the body and turns blank lines into paragraphs + single newlines into
// <br>. So: separate the two lines of a lead block with ONE newline, separate
// blocks/sections with a BLANK line. Never rely on leading-space indentation
// (HTML collapses it) — use "•" bullets and "·" separators instead.

/** "Mon Jul 6, 2:30pm" in the org timezone, or a graceful fallback. */
export function formatSnapshotTime(iso: string | null, tz: string): string {
  if (!iso) return "time TBD";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "time TBD";
  try {
    // Compose "Thu" + "Jun 25" separately so there's no comma after the weekday
    // (Intl's combined weekday+month+day inserts one).
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(new Date(ms));
    const monthDay = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
    const datePart = `${weekday} ${monthDay}`;
    let timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(new Date(ms))
      .toLowerCase()
      .replace(/\s/g, "");
    return `${datePart}, ${timePart}`;
  } catch {
    return "time TBD";
  }
}

const HEALTH_LABELS: Record<LeasingHealthStatus, string> = {
  green: "🟢 Healthy",
  yellow: "🟡 Watch",
  red: "🔴 Action needed",
  black: "⚫ Offline",
};

function yesNo(v: boolean): string {
  return v ? "yes" : "no";
}

function nextOpenDayLabel(day: string | null): string {
  return day ?? "none";
}

export function buildLeasingHealthBlock(
  health: LeasingHealth,
  tz: string,
): string {
  void tz;
  const label = HEALTH_LABELS[health.status];
  if (health.status === "green" && health.alerts.length === 0) {
    return `${label} — availability for the next ${health.futureOpenDays} days`;
  }

  const top = health.alerts[0]?.recommendation ?? "Keep the viewing calendar fresh.";
  const rollup =
    `Accepting bookings today: ${yesNo(health.hasToday)} · ` +
    `Openings tomorrow: ${yesNo(health.hasTomorrow)} · ` +
    `Next opening: ${nextOpenDayLabel(health.nextOpenDay)}`;

  const parts = [
    `LEASING HEALTH: ${label}`,
    `Recommendation: ${top}`,
    rollup,
  ];

  if (health.alerts.length > 0) {
    parts.push(
      [
        "NEEDS ATTENTION",
        ...health.alerts.map(
          (alert) => `• ${alert.message} ${alert.recommendation}`,
        ),
      ].join("\n"),
    );
  }

  return parts.join("\n");
}

// --- S701c layout: short, named, nothing that is not actionable -------------
// Noam 2026-10-08: the snapshot was "almost unusable, so cluttered and filled
// with useless info". It led with a calendar-health block (five identical
// unnamed "Live and un-bookable" lines and weekend/evening advice for an
// operator who opens one day at a time on purpose), printed full postal
// addresses, "Move-in: not given" filler, empty sections and a footer. Now:
// one count line, then only the sections that have rows, each row naming the
// unit in short form, and ads to refresh named by unit and site.

/** "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2" -> "1551 Assumption St, Unit 9". */
export function shortUnitLabel(addr: string | null): string {
  const parts = (addr ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "no unit on file";
  const second = parts[1] ?? "";
  if (/^(unit|suite|apt|apartment|#)\s*\S+/i.test(second)) {
    return `${parts[0]}, ${second}`;
  }
  return parts[0];
}

/** "+13828800724" / "2263506690" -> "382-880-0724"; anything else as typed. */
export function snapshotPhone(phone: string | null): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function shortDate(value: string | null, tz: string, dateOnly: boolean): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const ms = dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T12:00:00Z`) : Date.parse(v);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: dateOnly ? "UTC" : tz,
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

function leadLines(l: SnapshotLead, tz: string, withSince: boolean): string {
  const name = (l.name ?? "").trim() || "No name";
  const details = [
    snapshotPhone(l.phone),
    (() => {
      const src = (l.source ?? "").trim();
      return src ? src.charAt(0).toUpperCase() + src.slice(1) : null;
    })(),
    (() => {
      const d = shortDate(l.move_in, tz, true);
      return d ? `move-in ${d}` : null;
    })(),
    withSince
      ? (() => {
          const d = shortDate(l.created_at, tz, false);
          return d ? `asked ${d}` : null;
        })()
      : null,
  ].filter((x): x is string => Boolean(x));
  const line1 = `• ${name}, ${shortUnitLabel(l.property_address)}`;
  return details.length > 0 ? `${line1}\n${details.join(" · ")}` : line1;
}

function showingLines(s: SnapshotShowing, tz: string): string {
  const name = (s.name ?? "").trim() || "No name";
  const phone = snapshotPhone(s.phone);
  const line1 = `• ${formatSnapshotTime(s.scheduled_at, tz)}: ${name}, ${shortUnitLabel(s.property_address)}`;
  return phone ? `${line1}\n${phone}` : line1;
}

function capped(title: string, blocks: string[]): string {
  const shown = blocks.slice(0, SNAPSHOT_SECTION_CAP);
  const parts = [`${title} (${blocks.length})`, ...shown];
  if (blocks.length > SNAPSHOT_SECTION_CAP) {
    parts.push(`And ${blocks.length - SNAPSHOT_SECTION_CAP} more.`);
  }
  return parts.join("\n\n");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function adsSection(listingHealth: ListingHealthSnapshotSummary): string {
  const items = listingHealth.items ?? [];
  if (items.length === 0) {
    const line = `${plural(listingHealth.adCount, "ad needs", "ads need")} a refresh across ${plural(listingHealth.unitCount, "unit", "units")}.`;
    return listingHealth.firstDistributeUrl
      ? `ADS TO REFRESH (${listingHealth.adCount})\n\n${line}\n${listingHealth.firstDistributeUrl}`
      : `ADS TO REFRESH (${listingHealth.adCount})\n\n${line}`;
  }
  const byUnit = new Map<string, { address: string; url: string; sites: string[] }>();
  for (const item of items) {
    const entry = byUnit.get(item.propertyId) ?? {
      address: item.address,
      url: item.distributeUrl,
      sites: [],
    };
    const why = item.reason === "stale" ? "old" : "expired";
    entry.sites.push(`${item.channelLabel} (${why})`);
    byUnit.set(item.propertyId, entry);
  }
  const blocks = [...byUnit.values()].map(
    (u) => `• ${shortUnitLabel(u.address)}: ${u.sites.join(", ")}\n${u.url}`,
  );
  // Header counts ads, matching the count line; rows are one per unit.
  return [`ADS TO REFRESH (${items.length})`, ...blocks].join("\n\n");
}

/**
 * The `{{snapshot}}` token value. Pure. One count line, then only the
 * sections that have rows. Viewings always shows, because "none booked" is
 * the one empty state worth knowing. `health` is accepted for call-site
 * compatibility and deliberately not rendered (S701c).
 */
export function buildSnapshotBlock(
  b: SnapshotBuckets,
  tz: string,
  health?: LeasingHealth | null,
  listingHealth?: ListingHealthSnapshotSummary | null,
): string {
  void health;
  const viewings = [...b.showingsToday, ...b.showingsWeek];
  const adCount = listingHealth?.adCount ?? 0;
  const summary = [
    plural(b.newLeads.length, "new inquiry", "new inquiries"),
    plural(viewings.length, "viewing this week", "viewings this week"),
    plural(b.noShowing.length, "waiting for a viewing", "waiting for a viewing"),
    ...(adCount > 0 ? [plural(adCount, "ad to refresh", "ads to refresh")] : []),
  ].join(" · ");

  const sections: string[] = [summary];
  if (b.newLeads.length > 0) {
    sections.push(capped("NEW IN THE LAST 24 HOURS", b.newLeads.map((l) => leadLines(l, tz, false))));
  }
  sections.push(
    viewings.length > 0
      ? capped("VIEWINGS THIS WEEK", viewings.map((s) => showingLines(s, tz)))
      : "VIEWINGS THIS WEEK (0)\n\nNone booked.",
  );
  if (b.noShowing.length > 0) {
    sections.push(capped("WAITING FOR A VIEWING", b.noShowing.map((l) => leadLines(l, tz, true))));
  }
  if (listingHealth && adCount > 0) sections.push(adsSection(listingHealth));
  return sections.join("\n\n");
}

/** Subject-friendly date, e.g. "Thursday, June 25". */
export function snapshotDateLabel(nowMs: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}
