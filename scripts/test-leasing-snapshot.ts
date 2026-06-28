// Unit tests for the pure leasing.daily_snapshot digest logic.
// Run: npx tsx scripts/test-leasing-snapshot.ts
import {
  snapshotWindow,
  shouldSendSnapshot,
  buildSnapshotBlock,
  snapshotCounts,
  snapshotHasContent,
  formatSnapshotTime,
  snapshotDateLabel,
  localDateString,
  localHour,
  localWeekday,
  SNAPSHOT_SECTION_CAP,
  type SnapshotBuckets,
  type SnapshotLead,
  type SnapshotShowing,
} from "../lib/leasing-snapshot";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TZ = "America/Toronto"; // EDT (UTC-4) on these June dates

// --- timezone helpers --------------------------------------------------------
// 2026-06-25T18:30:00Z == 14:30 EDT, Thursday
const thuAfternoon = Date.UTC(2026, 5, 25, 18, 30, 0);
ok("localDate: Toronto afternoon", localDateString(thuAfternoon, TZ) === "2026-06-25");
ok("localHour: 14:30 EDT -> 14", localHour(thuAfternoon, TZ) === 14);
ok("localWeekday: Thursday -> 4", localWeekday(thuAfternoon, TZ) === 4);

// A UTC instant just after midnight UTC but still the PREVIOUS day in Toronto.
// 2026-06-25T02:00:00Z == 22:00 EDT on 2026-06-24.
const lateNight = Date.UTC(2026, 5, 25, 2, 0, 0);
ok("localDate: pre-4amUTC is previous Toronto day", localDateString(lateNight, TZ) === "2026-06-24");

// --- snapshotWindow ----------------------------------------------------------
const win = snapshotWindow(thuAfternoon, TZ);
ok("window: localDate", win.localDate === "2026-06-25");
ok("window: startToday = Toronto midnight (04:00Z)", win.startTodayIso === "2026-06-25T04:00:00.000Z");
ok("window: endToday = +1 day", win.endTodayIso === "2026-06-26T04:00:00.000Z");
ok("window: endWeek = +7 days", win.endWeekIso === "2026-07-02T04:00:00.000Z");
ok("window: cutoff24h = now-24h", win.cutoff24hIso === "2026-06-24T18:30:00.000Z");
ok("window: cutoff7d = now-7d", win.cutoff7dIso === "2026-06-18T18:30:00.000Z");

// --- shouldSendSnapshot ------------------------------------------------------
// Saturday 2026-06-27 16:00 EDT (20:00Z) -> weekend skip
const satAfternoon = Date.UTC(2026, 5, 27, 20, 0, 0);
ok(
  "gate: weekend skips",
  shouldSendSnapshot({ nowMs: satAfternoon, tz: TZ, snapshotHour: 16, lastSentOn: null }).reason === "weekend",
);
// Thursday 13:00 EDT (17:00Z), hour 16 -> before_hour
const thuBeforeShift = Date.UTC(2026, 5, 25, 17, 0, 0);
ok(
  "gate: before the hour skips",
  shouldSendSnapshot({ nowMs: thuBeforeShift, tz: TZ, snapshotHour: 16, lastSentOn: null }).reason === "before_hour",
);
// Thursday 16:30 EDT (20:30Z), hour 16, already sent today -> already_sent
const thuAfterShift = Date.UTC(2026, 5, 25, 20, 30, 0);
ok(
  "gate: already sent today skips",
  shouldSendSnapshot({ nowMs: thuAfterShift, tz: TZ, snapshotHour: 16, lastSentOn: "2026-06-25" }).reason === "already_sent",
);
// Thursday 16:30 EDT, hour 16, not yet sent -> due
const dueGate = shouldSendSnapshot({ nowMs: thuAfterShift, tz: TZ, snapshotHour: 16, lastSentOn: "2026-06-24" });
ok("gate: due sends", dueGate.send === true && dueGate.reason === "due");
ok("gate: due carries localDate", dueGate.localDate === "2026-06-25");
// weekdaysOnly:false lets Saturday through
ok(
  "gate: weekdaysOnly=false allows weekend",
  shouldSendSnapshot({ nowMs: satAfternoon, tz: TZ, snapshotHour: 16, lastSentOn: null, weekdaysOnly: false }).send === true,
);

// --- formatSnapshotTime ------------------------------------------------------
// 2026-06-25T18:30:00Z == 2:30pm EDT Thursday
ok("time: formats in tz", formatSnapshotTime("2026-06-25T18:30:00Z", TZ) === "Thu Jun 25, 2:30pm");
ok("time: null -> TBD", formatSnapshotTime(null, TZ) === "time TBD");
ok("time: garbage -> TBD", formatSnapshotTime("not-a-date", TZ) === "time TBD");

// --- counts + content gate ---------------------------------------------------
const lead = (over: Partial<SnapshotLead> = {}): SnapshotLead => ({
  name: "Jane Doe",
  phone: "519-555-1234",
  move_in: "2026-07-01",
  source: "kijiji",
  property_address: "22 King St W #602",
  created_at: "2026-06-25T12:00:00Z",
  ...over,
});
const showing = (over: Partial<SnapshotShowing> = {}): SnapshotShowing => ({
  name: "John Roe",
  phone: "519-555-9999",
  scheduled_at: "2026-06-25T18:30:00Z",
  property_address: "1440 Queen St E",
  ...over,
});

const empty: SnapshotBuckets = { newLeads: [], showingsToday: [], showingsWeek: [], noShowing: [] };
ok("content: empty has no content", snapshotHasContent(empty) === false);
ok("content: one new lead has content", snapshotHasContent({ ...empty, newLeads: [lead()] }) === true);
ok("content: one showing has content", snapshotHasContent({ ...empty, showingsToday: [showing()] }) === true);

const counts = snapshotCounts({
  newLeads: [lead(), lead()],
  showingsToday: [showing()],
  showingsWeek: [showing(), showing(), showing()],
  noShowing: [lead()],
});
ok(
  "counts: per bucket",
  counts.newCount === 2 &&
    counts.showingsTodayCount === 1 &&
    counts.showingsWeekCount === 3 &&
    counts.noShowingCount === 1,
);

// --- buildSnapshotBlock ------------------------------------------------------
const block = buildSnapshotBlock(
  { newLeads: [lead()], showingsToday: [showing()], showingsWeek: [], noShowing: [] },
  TZ,
);
ok("block: new-leads header with count", block.includes("NEW INQUIRIES — LAST 24 HOURS (1)"));
ok("block: lead name+unit line", block.includes("• Jane Doe — 22 King St W #602"));
ok("block: lead detail line", block.includes("Move-in: 2026-07-01 · Source: kijiji · Phone: 519-555-1234"));
ok("block: showings-today header", block.includes("VIEWINGS TODAY (1)"));
ok("block: showing time line", block.includes("Viewing: Thu Jun 25, 2:30pm · Phone: 519-555-9999"));
ok("block: empty week section message", block.includes("No viewings booked for the rest of the week."));
ok("block: empty nudge section message", block.includes("Every inquiry from this week has a viewing booked. Nice."));
// blocks separate with a blank line so the branded shell renders paragraphs
ok("block: blank-line separated", block.includes("\n\n"));

// missing fields degrade gracefully (no name/phone/unit)
const sparse = buildSnapshotBlock(
  { newLeads: [lead({ name: null, phone: "", move_in: null, source: null, property_address: null })], showingsToday: [], showingsWeek: [], noShowing: [] },
  TZ,
);
ok("block: missing name fallback", sparse.includes("(no name on file)"));
ok("block: missing unit fallback", sparse.includes("(no unit specified)"));
ok("block: missing move-in/source/phone fallbacks", sparse.includes("Move-in: not given · Source: Unknown · Phone: no phone on file"));

// cap: more than SNAPSHOT_SECTION_CAP leads -> overflow line
const many = Array.from({ length: SNAPSHOT_SECTION_CAP + 5 }, (_, i) => lead({ name: `Lead ${i}` }));
const capped = buildSnapshotBlock({ newLeads: many, showingsToday: [], showingsWeek: [], noShowing: [] }, TZ);
ok("block: caps long section", capped.includes(`NEW INQUIRIES — LAST 24 HOURS (${SNAPSHOT_SECTION_CAP + 5})`));
ok("block: shows overflow count", capped.includes("…and 5 more not shown."));

// --- snapshotDateLabel -------------------------------------------------------
ok("date label: human readable", snapshotDateLabel(thuAfternoon, TZ) === "Thursday, June 25");

console.log(`\nleasing-snapshot: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
