// Run with: npx tsx scripts/test-booking.ts
//
// Covers the showing-clustering ("Hero blocks") layer added on top of the
// existing slot generator: building-key normalization, the per-day clustering
// window math, capacity skipping, opt-in passthrough, and that generateSlots +
// isValidSlot stay in agreement when clustering is on.

import {
  buildingKey,
  clusterDays,
  generateSlots,
  isValidSlot,
  groupShowingsIntoBlocks,
  previewSlotStarts,
  type Availability,
  type DaySlots,
} from "../lib/booking";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}\n   got  ${g}\n   want ${w}`);
  }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

// --- buildingKey ----------------------------------------------------------
eq("strips Unit designator", buildingKey("833 Pillette Rd Unit 22"), "833 pillette rd");
eq("Rd and Road fold to the same key",
  buildingKey("833 Pillette Road #27"), buildingKey("833 Pillette Rd Unit 22"));
eq("strips everything after the first comma",
  buildingKey("100 King St W, Suite 500, Toronto"), "100 king st w");
eq("Apt designator + Street→st fold", buildingKey("12 Main Street Apt 3B"), "12 main st");
eq("Apartment word", buildingKey("12 Main St Apartment 3"), "12 main st");
eq("# unit", buildingKey("55 Bloor Ave #1201"), "55 bloor ave");
eq("blank address → empty key", buildingKey(""), "");
eq("null address → empty key", buildingKey(null), "");
ok("two units in the same building share a key",
  buildingKey("833 Pillette Rd Unit 22") === buildingKey("833 Pillette Rd Unit 27"));
ok("different buildings differ",
  buildingKey("833 Pillette Rd Unit 22") !== buildingKey("835 Pillette Rd Unit 22"));

// --- clusterDays window math ----------------------------------------------
// Build a synthetic day with 30-min slots from 13:00 to 16:00 UTC.
function dayOf(dayKey: string, hoursUtc: number[]): DaySlots {
  return {
    dayKey,
    dayLabel: dayKey,
    slots: hoursUtc.map((h) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      const iso = `${dayKey}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
      return { iso, label: `${hh}:${String(mm).padStart(2, "0")}` };
    }),
  };
}
const slotHours = [13, 13.5, 14, 14.5, 15, 15.5, 16];
const oneDay = [dayOf("2026-07-01", slotHours)];

// Anchor at 14:30 UTC, buffer 60m → keep [13:30 .. 15:30]; tag clustered.
const anchor1430 = new Date("2026-07-01T14:30:00.000Z").getTime();
const c1 = clusterDays(oneDay, [anchor1430], { timeZone: "UTC", bufferMinutes: 60, capacity: 6 });
eq("clustered window keeps 13:30..15:30",
  c1[0].slots.map((s) => s.iso),
  ["2026-07-01T13:30:00.000Z", "2026-07-01T14:00:00.000Z", "2026-07-01T14:30:00.000Z",
   "2026-07-01T15:00:00.000Z", "2026-07-01T15:30:00.000Z"]);
ok("kept slots are tagged clustered", c1[0].slots.every((s) => s.clustered === true));

// Two anchors widen the window: 13:30 and 15:00, buffer 30m → [13:00 .. 15:30].
const c2 = clusterDays(
  oneDay,
  [new Date("2026-07-01T13:30:00.000Z").getTime(), new Date("2026-07-01T15:00:00.000Z").getTime()],
  { timeZone: "UTC", bufferMinutes: 30, capacity: 6 },
);
eq("two anchors widen the window",
  c2[0].slots.map((s) => s.iso),
  ["2026-07-01T13:00:00.000Z", "2026-07-01T13:30:00.000Z", "2026-07-01T14:00:00.000Z",
   "2026-07-01T14:30:00.000Z", "2026-07-01T15:00:00.000Z", "2026-07-01T15:30:00.000Z"]);

// Capacity reached → the whole day is dropped.
const capAnchors = [
  "2026-07-01T13:00:00.000Z", "2026-07-01T13:30:00.000Z", "2026-07-01T14:00:00.000Z",
].map((s) => new Date(s).getTime());
const c3 = clusterDays(oneDay, capAnchors, { timeZone: "UTC", bufferMinutes: 60, capacity: 3 });
eq("capacity reached drops the day", c3.length, 0);

// A day with NO anchor for this building keeps full availability (new anchor).
const twoDays = [dayOf("2026-07-01", slotHours), dayOf("2026-07-02", slotHours)];
const c4 = clusterDays(twoDays, [new Date("2026-07-01T14:00:00.000Z").getTime()], {
  timeZone: "UTC", bufferMinutes: 30, capacity: 6,
});
ok("anchored day is narrowed", c4.find((d) => d.dayKey === "2026-07-01")!.slots.length < slotHours.length);
eq("un-anchored day keeps all slots + stays untagged",
  c4.find((d) => d.dayKey === "2026-07-02")!.slots.map((s) => s.clustered ?? null),
  slotHours.map(() => null));

// --- generateSlots opt-in + agreement with isValidSlot --------------------
// Org open Wednesday (weekday 3) 10:00–12:00 local; UTC tz keeps math simple.
const baseAv: Availability = {
  timezone: "UTC",
  slot_minutes: 30,
  lead_hours: 0,
  horizon_days: 9,
  rules: [{ weekday: 3, start_minute: 600, end_minute: 720 }], // Wed 10:00-12:00
  booked: [],
};
// A fixed "now" = Mon 2026-06-29 09:00 UTC; the next Wednesday is 2026-07-01.
const now = new Date("2026-06-29T09:00:00.000Z");

const offDays = generateSlots(baseAv, now);
const onDaysNoAnchor = generateSlots(
  { ...baseAv, clustering_enabled: true, clustering_buffer_minutes: 60,
    showing_block_capacity: 6, cluster_candidates: [], target_address: "833 Pillette Rd Unit 22" },
  now,
);
eq("clustering with no anchors is a passthrough (same slots)",
  onDaysNoAnchor.map((d) => d.slots.map((s) => s.iso)),
  offDays.map((d) => d.slots.map((s) => s.iso)));

// Now an existing showing for the SAME building at Wed 10:30 UTC, buffer 30m →
// only 10:00..11:00 survive on that day.
const onDaysAnchored = generateSlots(
  {
    ...baseAv,
    clustering_enabled: true,
    clustering_buffer_minutes: 30,
    showing_block_capacity: 6,
    target_address: "833 Pillette Rd Unit 27",
    cluster_candidates: [
      { address: "833 Pillette Rd Unit 22", scheduled_at: "2026-07-01T10:30:00.000Z" },
      // a DIFFERENT building should be ignored:
      { address: "999 Tecumseh Rd Unit 1", scheduled_at: "2026-07-01T11:30:00.000Z" },
    ],
  },
  now,
);
const wed = onDaysAnchored.find((d) => d.dayKey === "2026-07-01")!;
eq("anchored same-building day narrows to 10:00..11:00",
  wed.slots.map((s) => s.iso),
  ["2026-07-01T10:00:00.000Z", "2026-07-01T10:30:00.000Z", "2026-07-01T11:00:00.000Z"]);
ok("isValidSlot agrees a clustered slot is bookable",
  isValidSlot(
    { ...baseAv, clustering_enabled: true, clustering_buffer_minutes: 30,
      showing_block_capacity: 6, target_address: "833 Pillette Rd Unit 27",
      cluster_candidates: [{ address: "833 Pillette Rd Unit 22", scheduled_at: "2026-07-01T10:30:00.000Z" }] },
    "2026-07-01T11:00:00.000Z", now));
ok("isValidSlot rejects an out-of-window slot when clustering is on",
  !isValidSlot(
    { ...baseAv, clustering_enabled: true, clustering_buffer_minutes: 30,
      showing_block_capacity: 6, target_address: "833 Pillette Rd Unit 27",
      cluster_candidates: [{ address: "833 Pillette Rd Unit 22", scheduled_at: "2026-07-01T10:30:00.000Z" }] },
    "2026-07-01T11:30:00.000Z", now)); // same (anchored) day, but outside the 10:00-11:00 window

// --- groupShowingsIntoBlocks ----------------------------------------------
const blocks = groupShowingsIntoBlocks(
  [
    { address: "833 Pillette Rd Unit 22", scheduled_at: "2026-07-01T14:00:00.000Z" },
    { address: "833 Pillette Rd Unit 27", scheduled_at: "2026-07-01T15:30:00.000Z" },
    { address: "999 Tecumseh Rd", scheduled_at: "2026-07-01T13:00:00.000Z" },
    { address: "833 Pillette Rd Unit 5", scheduled_at: "2026-07-02T10:00:00.000Z" },
    { address: null, scheduled_at: null }, // ignored
  ],
  "UTC",
);
eq("three blocks (Pillette x2 days + Tecumseh)", blocks.length, 3);
const pilletteJul1 = blocks.find(
  (b) => b.buildingKey === buildingKey("833 Pillette Rd") && b.dayKey === "2026-07-01",
)!;
eq("Pillette Jul 1 groups 2 showings", pilletteJul1.count, 2);
eq("block start = earliest", pilletteJul1.startIso, "2026-07-01T14:00:00.000Z");
eq("block end = latest", pilletteJul1.endIso, "2026-07-01T15:30:00.000Z");
ok("blocks sorted by start", blocks[0].startIso <= blocks[1].startIso && blocks[1].startIso <= blocks[2].startIso);

// --- previewSlotStarts (Showing-times "what renters will see" panel) -------
eq("30-min slots in 10:00-12:00 = 4 starts",
  previewSlotStarts(600, 720, 30).length, 4);
eq("first start = window start", previewSlotStarts(600, 720, 30)[0], 600);
eq("last start leaves room for the slot", previewSlotStarts(600, 720, 30).at(-1), 690);
eq("drops a trailing partial slot (10:00-11:20 @ 30 = 2)",
  previewSlotStarts(600, 680, 30).length, 2);
eq("60-min slots in 9:00-17:00 = 8", previewSlotStarts(540, 1020, 60).length, 8);
eq("non-positive slot falls back to 30 (10:00-11:00 = 2)",
  previewSlotStarts(600, 660, 0).length, 2);
eq("empty window yields none", previewSlotStarts(600, 600, 30).length, 0);
eq("window shorter than a slot yields none", previewSlotStarts(600, 615, 30).length, 0);
// Matches generateSlots' own per-window stepping exactly.
{
  const av: Availability = {
    timezone: "UTC", slot_minutes: 30, lead_hours: 0, horizon_days: 1,
    rules: [{ weekday: 3, start_minute: 600, end_minute: 720 }], booked: [],
  };
  const gen = generateSlots(av, new Date("2026-07-01T00:00:00.000Z")); // Wed
  const wed = gen.find((d) => d.dayKey === "2026-07-01");
  eq("generateSlots agrees with previewSlotStarts count",
    wed?.slots.length, previewSlotStarts(600, 720, 30).length);
}

console.log(`\nbooking: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
