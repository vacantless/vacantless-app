// Run with: npx tsx scripts/test-leasing-health.ts
//
// Focused unit tests for the pure S513-H1 Leasing Health engine and its daily
// snapshot rendering hooks. No DB/network.

import {
  assessLeasingHealth,
  countOpenBookableSlots,
  hasEveningSlot,
  hasWeekendSlot,
  openBookableDays,
  type LeasingHealth,
  type LeasingHealthInput,
} from "../lib/leasing-health";
import {
  buildLeasingHealthBlock,
  buildSnapshotBlock,
  snapshotHasContent,
  type SnapshotBuckets,
} from "../lib/leasing-snapshot";
import {
  zonedWallTimeToUtc,
  type Availability,
} from "../lib/booking";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

const TZ = "America/Toronto";
const DAY_MS = 24 * 3_600_000;
const SAT_NOW = new Date("2026-07-18T12:00:00.000Z"); // Sat 8am EDT
const MON_NOW = new Date("2026-07-20T12:00:00.000Z"); // Mon 8am EDT
const SAT_DAY = "2026-07-18";
const MON_DAY = "2026-07-20";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addDays(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`bad dayKey ${dayKey}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isoFor(dayKey: string, minute: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`bad dayKey ${dayKey}`);
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    minute,
    TZ,
  ).toISOString();
}

function avForOffsets(
  baseDay: string,
  offsets: number[],
  opts: {
    startMinute?: number;
    slotMinutes?: number;
    horizonDays?: number;
    booked?: string[];
  } = {},
): Availability {
  const start = opts.startMinute ?? 17 * 60;
  const slot = opts.slotMinutes ?? 30;
  return {
    timezone: TZ,
    slot_minutes: slot,
    lead_hours: 0,
    horizon_days: opts.horizonDays ?? 30,
    rules: [],
    booked: opts.booked ?? [],
    days_off: [],
    overrides: offsets.map((offset) => ({
      day: addDays(baseDay, offset),
      start_minute: start,
      end_minute: start + slot,
    })),
  };
}

function listing(
  over: Partial<LeasingHealthInput["listings"][number]> = {},
): LeasingHealthInput["listings"][number] {
  return {
    propertyId: "p1",
    address: "833 Pillette Rd Unit 20",
    status: "available",
    createdAtMs: SAT_NOW.getTime(),
    openInquiries: 0,
    bookedInstants: [],
    ...over,
  };
}

function assess(
  av: Availability,
  over: Partial<LeasingHealthInput> = {},
): LeasingHealth {
  return assessLeasingHealth({
    now: SAT_NOW,
    windowDays: 7,
    availability: av,
    lastWindowChangeMs: null,
    listings: [listing()],
    ...over,
  });
}

function codes(health: LeasingHealth): string[] {
  return health.alerts.map((a) => a.code);
}

// --- booked-aware slot primitives ------------------------------------------
const singleSlotDay = avForOffsets(SAT_DAY, [0]);
const bookedSingleSlot = avForOffsets(SAT_DAY, [0], {
  booked: [isoFor(SAT_DAY, 17 * 60)],
});
ok("primitive: open day counts the unbooked slot", openBookableDays(singleSlotDay, SAT_NOW, 7).length === 1);
ok("primitive: open slot count excludes real booked instants", countOpenBookableSlots(bookedSingleSlot, SAT_NOW, 7) === 0);
ok("primitive: booked slot removes the day", openBookableDays(bookedSingleSlot, SAT_NOW, 7).length === 0);
ok("primitive: evening slot detected in org time", hasEveningSlot(singleSlotDay, SAT_NOW, 7) === true);
ok("primitive: weekend slot detected in org time", hasWeekendSlot(singleSlotDay, SAT_NOW, 7) === true);

// --- status boundaries ------------------------------------------------------
const black = assess(avForOffsets(SAT_DAY, []));
ok("status: D=0 with available listing -> black", black.status === "black");

const idleZero = assess(avForOffsets(SAT_DAY, []), { listings: [] });
ok("status: D=0 with no available listing -> not black", idleZero.status !== "black");

const red = assess(avForOffsets(SAT_DAY, [0]));
ok("status: D=1 -> red", red.status === "red");

const yellowByCount = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3]));
ok("status: D=4 -> yellow", yellowByCount.status === "yellow");

const green = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3, 4, 5, 6]));
ok("status: D=7 with evenings+weekends -> green", green.status === "green");

const noWeekendEight = assess(
  avForOffsets(MON_DAY, [0, 1, 2, 3, 4, 7, 8, 9]),
  { now: MON_NOW, windowDays: 10 },
);
ok("status: D=8 but no weekend -> yellow", noWeekendEight.status === "yellow");

// --- alert conditions -------------------------------------------------------
ok("alert: offline fires for available listing with D=0", codes(black).includes("offline"));
ok("alert: offline does not fire without an available listing", !codes(idleZero).includes("offline"));

ok("alert: ends_tomorrow fires only at D=1", codes(red).includes("ends_tomorrow"));
ok("alert: ends_tomorrow suppresses ends_soon", !codes(red).includes("ends_soon"));
const twoDays = assess(avForOffsets(SAT_DAY, [0, 1]));
ok("alert: ends_soon fires above D=1 and below green", codes(twoDays).includes("ends_soon"));
ok("alert: ends_soon does not double-fire ends_tomorrow", !codes(twoDays).includes("ends_tomorrow"));

ok("alert: no_weekend fires when every slot is weekday", codes(noWeekendEight).includes("no_weekend"));
ok("alert: no_weekend stays quiet when a weekend slot exists", !codes(green).includes("no_weekend"));

const daytimeWeek = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3, 4, 5, 6], { startMinute: 10 * 60 }));
ok("alert: no_evening fires when all slots are before 5pm", codes(daytimeWeek).includes("no_evening"));
ok("alert: no_evening stays quiet when an evening slot exists", !codes(green).includes("no_evening"));

const stale = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3, 4, 5, 6]), {
  lastWindowChangeMs: SAT_NOW.getTime() - 12 * DAY_MS,
});
const recent = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3, 4, 5, 6]), {
  lastWindowChangeMs: SAT_NOW.getTime() - 11 * DAY_MS,
});
ok("alert: stale_calendar fires at 12 days", codes(stale).includes("stale_calendar"));
ok("alert: stale_calendar stays quiet before 12 days", !codes(recent).includes("stale_calendar"));

const demand = assess(avForOffsets(SAT_DAY, [0, 1]), {
  listings: [listing({ openInquiries: 5 })],
});
const lowDemand = assess(avForOffsets(SAT_DAY, [0, 1]), {
  listings: [listing({ openInquiries: 4 })],
});
const demandWithRunway = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3, 4, 5, 6]), {
  listings: [listing({ openInquiries: 5 })],
});
ok("alert: demand_pressure needs inquiries and thin days", codes(demand).includes("demand_pressure"));
ok("alert: demand_pressure stays quiet below 5 inquiries", !codes(lowDemand).includes("demand_pressure"));
ok("alert: demand_pressure stays quiet when runway is healthy", !codes(demandWithRunway).includes("demand_pressure"));

const staleListingNoWeekend = assess(
  avForOffsets(MON_DAY, [0, 1, 2, 3, 4, 7, 8, 9]),
  {
    now: MON_NOW,
    windowDays: 10,
    listings: [
      listing({
        createdAtMs: MON_NOW.getTime() - 8 * DAY_MS,
      }),
    ],
  },
);
const freshListingNoWeekend = assess(
  avForOffsets(MON_DAY, [0, 1, 2, 3, 4, 7, 8, 9]),
  { now: MON_NOW, windowDays: 10 },
);
const staleListingWithWeekend = assess(avForOffsets(SAT_DAY, [0, 1, 2, 3, 4, 5, 6]), {
  listings: [listing({ createdAtMs: SAT_NOW.getTime() - 8 * DAY_MS })],
});
ok("alert: listing_stale_no_weekend needs days live and no weekend", codes(staleListingNoWeekend).includes("listing_stale_no_weekend"));
ok("alert: listing_stale_no_weekend stays quiet before 7 days", !codes(freshListingNoWeekend).includes("listing_stale_no_weekend"));
ok("alert: listing_stale_no_weekend stays quiet when weekend exists", !codes(staleListingWithWeekend).includes("listing_stale_no_weekend"));

// --- ranking + rendering ----------------------------------------------------
const ranked = assess(avForOffsets(SAT_DAY, []), {
  lastWindowChangeMs: SAT_NOW.getTime() - 20 * DAY_MS,
  listings: [listing({ createdAtMs: SAT_NOW.getTime() - 20 * DAY_MS, openInquiries: 5 })],
});
ok("ranking: worst alert first", ranked.alerts[0]?.code === "offline");
ok(
  "ranking: severities sorted descending",
  ranked.alerts.every((alert, i, arr) => i === 0 || arr[i - 1].severity >= alert.severity),
);

ok(
  "render: green+quiet collapses to one line",
  buildLeasingHealthBlock(green, TZ) === "🟢 Healthy — availability for the next 7 days",
);
const redBlock = buildLeasingHealthBlock(red, TZ);
ok("render: non-green includes status line", redBlock.includes("LEASING HEALTH: 🔴 Action needed"));
ok("render: non-green includes recommendation", redBlock.includes("Recommendation: Add windows past 2026-07-18."));
ok("render: non-green includes needs-attention list", redBlock.includes("NEEDS ATTENTION"));

// --- snapshot send/content hooks -------------------------------------------
const emptyBuckets: SnapshotBuckets = {
  newLeads: [],
  showingsToday: [],
  showingsWeek: [],
  noShowing: [],
};
ok("snapshotHasContent: black health forces send", snapshotHasContent(emptyBuckets, black) === true);
ok("snapshotHasContent: red health forces send", snapshotHasContent(emptyBuckets, red) === true);
ok("snapshotHasContent: yellow health stays quiet without buckets", snapshotHasContent(emptyBuckets, yellowByCount) === false);
ok("snapshotHasContent: green health stays quiet without buckets", snapshotHasContent(emptyBuckets, green) === false);

const snapshot = buildSnapshotBlock(emptyBuckets, TZ, red);
ok(
  "snapshot: health block is prepended above new inquiries",
  snapshot.indexOf("LEASING HEALTH") >= 0 &&
    snapshot.indexOf("LEASING HEALTH") < snapshot.indexOf("NEW INQUIRIES — LAST 24 HOURS"),
);

// --- S513-H1 verification fixes (Cowork, 2026-07-18) -----------------------
const emptyAvail: Availability = {
  timezone: TZ,
  slot_minutes: 30,
  lead_hours: 12,
  horizon_days: 14,
  rules: [],
  booked: [],
  days_off: [],
  overrides: [],
};

// Fix 1: an org with NO available listings has no bookable inventory, so it must
// stay quiet (green, no alerts, no forced send) instead of computing red.
const noListings = assessLeasingHealth({
  now: MON_NOW,
  windowDays: 7,
  availability: emptyAvail,
  lastWindowChangeMs: null,
  listings: [],
});
ok("fix1: no available listings => green", noListings.status === "green");
ok("fix1: no available listings => no alerts", noListings.alerts.length === 0);
ok(
  "fix1: no available listings => does not force send",
  snapshotHasContent(emptyBuckets, noListings) === false,
);
// Control: a listing that IS available with an empty calendar still goes black.
const oneOffline = assessLeasingHealth({
  now: MON_NOW,
  windowDays: 7,
  availability: emptyAvail,
  lastWindowChangeMs: null,
  listings: [
    {
      propertyId: "p1",
      address: "1 Main",
      status: "available",
      createdAtMs: Date.parse("2026-06-01T00:00:00Z"),
      openInquiries: 0,
      bookedInstants: [],
    },
  ],
});
ok("fix1 control: available+empty => black", oneOffline.status === "black");
ok(
  "fix1 control: available+empty => offline alert present",
  oneOffline.alerts.some((a) => a.code === "offline"),
);

// Fix 2: weekend availability is org-level, so many weekday-only listings collapse
// to a SINGLE org-scoped stale-no-weekend alert, not one per listing.
const mondayOnly: Availability = {
  ...emptyAvail,
  rules: [{ weekday: 1, start_minute: 1080, end_minute: 1260 }],
};
const manyNoWeekend = assessLeasingHealth({
  now: MON_NOW,
  windowDays: 7,
  availability: mondayOnly,
  lastWindowChangeMs: null,
  listings: Array.from({ length: 5 }, (_, i) => ({
    propertyId: `p${i}`,
    address: `${i} Main`,
    status: "available",
    createdAtMs: Date.parse("2026-06-01T00:00:00Z"),
    openInquiries: 0,
    bookedInstants: [],
  })),
});
const staleAlerts = manyNoWeekend.alerts.filter(
  (a) => a.code === "listing_stale_no_weekend",
);
ok("fix2: stale-no-weekend collapses to one alert", staleAlerts.length === 1);
ok("fix2: stale-no-weekend is org-scoped", staleAlerts[0]?.scope === "org");
ok(
  "fix2: stale-no-weekend counts affected listings",
  staleAlerts[0]?.message.startsWith("5 listings"),
);

console.log(`\nleasing-health: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
