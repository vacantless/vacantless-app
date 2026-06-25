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
export function snapshotHasContent(b: SnapshotBuckets): boolean {
  return (
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

function cleanName(name: string | null): string {
  const t = (name ?? "").trim();
  return t || "(no name on file)";
}

function cleanUnit(addr: string | null): string {
  const t = (addr ?? "").trim();
  return t || "(no unit specified)";
}

function cleanPhone(phone: string | null): string {
  const t = (phone ?? "").trim();
  return t || "no phone on file";
}

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

function leadBlock(l: SnapshotLead): string {
  const moveIn = (l.move_in ?? "").trim() || "not given";
  const source = (l.source ?? "").trim() || "Unknown";
  const line1 = `• ${cleanName(l.name)} — ${cleanUnit(l.property_address)}`;
  const line2 = `Move-in: ${moveIn} · Source: ${source} · Phone: ${cleanPhone(l.phone)}`;
  return `${line1}\n${line2}`;
}

function showingBlock(s: SnapshotShowing, tz: string): string {
  const line1 = `• ${cleanName(s.name)} — ${cleanUnit(s.property_address)}`;
  const line2 = `Showing: ${formatSnapshotTime(s.scheduled_at, tz)} · Phone: ${cleanPhone(s.phone)}`;
  return `${line1}\n${line2}`;
}

function section(title: string, blocks: string[], emptyMsg: string): string {
  const shown = blocks.slice(0, SNAPSHOT_SECTION_CAP);
  const header = `${title} (${blocks.length})`;
  if (blocks.length === 0) return `${header}\n\n${emptyMsg}`;
  const parts = [header, ...shown];
  if (blocks.length > SNAPSHOT_SECTION_CAP) {
    parts.push(`…and ${blocks.length - SNAPSHOT_SECTION_CAP} more not shown.`);
  }
  return parts.join("\n\n");
}

/**
 * The `{{snapshot}}` token value: the four labeled sections as plain text,
 * ready for the substrate's branded shell. Pure. The route fetches the rows;
 * this lays them out. Always returns all four sections (with counts) so the
 * digest reads as a status view even when a section is empty.
 */
export function buildSnapshotBlock(b: SnapshotBuckets, tz: string): string {
  return [
    section(
      "NEW LEADS — LAST 24 HOURS",
      b.newLeads.map(leadBlock),
      "No new leads in the last 24 hours.",
    ),
    section(
      "SHOWINGS TODAY",
      b.showingsToday.map((s) => showingBlock(s, tz)),
      "No showings booked for today.",
    ),
    section(
      "SHOWINGS LATER THIS WEEK",
      b.showingsWeek.map((s) => showingBlock(s, tz)),
      "No showings booked for the rest of the week.",
    ),
    section(
      "CAME IN THIS WEEK, NO SHOWING BOOKED YET",
      b.noShowing.map(leadBlock),
      "Every lead from this week has a showing booked. Nice.",
    ),
  ].join("\n\n");
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
