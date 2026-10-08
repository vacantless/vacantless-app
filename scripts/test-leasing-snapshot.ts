// Unit tests for the pure leasing.daily_snapshot digest logic.
// Run: npx tsx scripts/test-leasing-snapshot.ts
import { readFileSync } from "node:fs";
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
import type { ListingHealthSnapshotSummary } from "../lib/listing-health";

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
const listingHealth: ListingHealthSnapshotSummary = {
  adCount: 2,
  unitCount: 1,
  firstDistributeUrl: "https://app.vacantless.com/dashboard/properties/property-1?tab=distribute",
};
const preS548QuietBlock = buildSnapshotBlock(empty, TZ);
const notOptedListingHealth: ListingHealthSnapshotSummary | null = null;
ok("content: non-opted listing health stays empty", snapshotHasContent(empty, null, notOptedListingHealth) === false);
ok("block: non-opted listing health is byte-unchanged", buildSnapshotBlock(empty, TZ, null, notOptedListingHealth) === preS548QuietBlock);
ok("block: non-opted listing health omits ads", !buildSnapshotBlock(empty, TZ, null, notOptedListingHealth).includes("ADS TO REFRESH"));
ok("content: opted listing health has content", snapshotHasContent(empty, null, listingHealth) === true);
const zeroListingHealth: ListingHealthSnapshotSummary = {
  adCount: 0,
  unitCount: 0,
  firstDistributeUrl: null,
};
ok("content: opted zero listing health stays empty", snapshotHasContent(empty, null, zeroListingHealth) === false);
ok("block: opted zero listing health omits ads", !buildSnapshotBlock(empty, TZ, null, zeroListingHealth).includes("ADS TO REFRESH"));

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

// --- buildSnapshotBlock (S701c layout) ---------------------------------------
const block = buildSnapshotBlock(
  { newLeads: [lead()], showingsToday: [showing()], showingsWeek: [], noShowing: [] },
  TZ,
);
ok("block: count line first", block.startsWith("1 new inquiry · 1 viewing this week · 0 waiting for a viewing"));
ok("block: new header with count", block.includes("NEW IN THE LAST 24 HOURS (1)"));
ok("block: lead name+unit line", block.includes("• Jane Doe, 22 King St W #602"));
ok("block: lead detail line", block.includes("519-555-1234 · Kijiji · move-in Jul 1"));
ok("block: viewing line names time, renter and unit", block.includes("• Thu Jun 25, 2:30pm: John Roe, 1440 Queen St E"));
ok("block: empty waiting section omitted", !block.includes("WAITING FOR A VIEWING ("));
ok("block: no filler", !block.includes("not given") && !block.includes("Nice.") && !block.includes("no phone on file"));
ok("block: no em dash", !block.includes("\u2014"));
ok("block: blank-line separated", block.includes("\n\n"));

const quiet = buildSnapshotBlock(empty, TZ);
ok("block: empty viewings says none booked", quiet.includes("VIEWINGS THIS WEEK (0)\n\nNone booked."));

const agile = buildSnapshotBlock(
  {
    newLeads: [],
    showingsToday: [],
    showingsWeek: [],
    noShowing: [
      lead({ name: "Avani Panchal", phone: "+13828800724", source: "Facebook Marketplace", move_in: "2026-11-01", property_address: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", created_at: "2026-10-05T14:00:00Z" }),
    ],
  },
  TZ,
);
ok("block: short unit drops city and postal code", agile.includes("• Avani Panchal, 1551 Assumption St, Unit 9\n") && !agile.includes("N9A 3E2"));
ok("block: phone normalized", agile.includes("382-880-0724"));
ok("block: waiting row says when they asked", agile.includes("move-in Nov 1 · asked Oct 5"));

const listingHealthBlock = buildSnapshotBlock(empty, TZ, null, listingHealth);
ok("block: ads section falls back to the count line", listingHealthBlock.includes("ADS TO REFRESH (2)") && listingHealthBlock.includes("2 ads need a refresh across 1 unit."));
ok("block: ads fallback links Distribute", listingHealthBlock.includes("?tab=distribute"));
const named = buildSnapshotBlock(empty, TZ, null, {
  adCount: 3,
  unitCount: 2,
  firstDistributeUrl: "https://x/p1",
  items: [
    { propertyId: "p1", address: "1195 Bruce Ave, Unit 303, Windsor, ON N9A 4Y5", channelLabel: "Facebook Marketplace", reason: "stale", distributeUrl: "https://x/p1" },
    { propertyId: "p1", address: "1195 Bruce Ave, Unit 303, Windsor, ON N9A 4Y5", channelLabel: "Zumper", reason: "stale", distributeUrl: "https://x/p1" },
    { propertyId: "p2", address: "833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4", channelLabel: "Kijiji", reason: "expired_or_removed", distributeUrl: "https://x/p2" },
  ],
});
ok("block: ads grouped by unit with sites", named.includes("• 1195 Bruce Ave, Unit 303: Facebook Marketplace (old), Zumper (old)\nhttps://x/p1"));
ok("block: expired ad named", named.includes("• 833 Pillette Rd, Unit 3: Kijiji (expired)\nhttps://x/p2"));
ok("block: ads header counts ads", named.includes("ADS TO REFRESH (3)"));
ok("block: ads count in summary", named.startsWith("0 new inquiries · 0 viewings this week · 0 waiting for a viewing · 3 ads to refresh"));

// missing fields degrade gracefully (no name/phone/unit)
const sparse = buildSnapshotBlock(
  { newLeads: [lead({ name: null, phone: "", move_in: null, source: null, property_address: null })], showingsToday: [], showingsWeek: [], noShowing: [] },
  TZ,
);
ok("block: missing name fallback", sparse.includes("• No name, no unit on file"));
ok("block: missing details print nothing", !sparse.includes("not given") && !sparse.includes("Unknown"));

// cap: more than SNAPSHOT_SECTION_CAP leads -> overflow line
const many = Array.from({ length: SNAPSHOT_SECTION_CAP + 5 }, (_, i) => lead({ name: `Lead ${i}` }));
const capped = buildSnapshotBlock({ newLeads: many, showingsToday: [], showingsWeek: [], noShowing: [] }, TZ);
ok("block: caps long section", capped.includes(`NEW IN THE LAST 24 HOURS (${SNAPSHOT_SECTION_CAP + 5})`));
ok("block: shows overflow count", capped.includes("And 5 more."));

// --- snapshotDateLabel -------------------------------------------------------
ok("date label: human readable", snapshotDateLabel(thuAfternoon, TZ) === "Thursday, June 25");

// --- route guardrails --------------------------------------------------------
const routeSource = readFileSync("app/api/cron/leasing-snapshot/route.ts", "utf8");
ok("route uses listing-health event key", routeSource.includes('const LISTING_HEALTH_EVENT_KEY = "leasing.listing_health"'));
ok("route uses drip opt-in helper", routeSource.includes("isDripEnqueueEnabled(listingHealthSetting)"));
ok("route skips listing health summary when not opted in", routeSource.includes("listingHealthEnabled") && routeSource.includes(": null"));
ok("route content gate reads the gated summary", routeSource.includes("snapshotHasContent(buckets, health, listingHealth)"));

console.log(`\nleasing-snapshot: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
