// Unit tests for the pure repair-scheduling matcher (S386 Slice 1).
// Run: npx tsx scripts/test-repair-scheduling.ts
import {
  MINUTES_PER_DAY,
  DEFAULT_MIN_PARTIAL_MINUTES,
  COMMON_ARRIVAL_WINDOW_PRESETS,
  isValidIsoDate,
  validateDayWindow,
  normalizeWindows,
  weekdayOfIsoDate,
  isValidSupplierRule,
  expandRulesToDates,
  windowKey,
  sortWindows,
  dedupeWindows,
  windowsToRules,
  datesInPlay,
  mergeIntervals,
  intersectInterval,
  subtractCovered,
  intervalMinutes,
  matchSupplierWindows,
  availableSupplierWindows,
  intersectWindows,
  formatClock,
  formatWindowClock,
  formatIsoDateShort,
  formatDayWindow,
  matchStatusLabel,
  matchStatusTone,
  type DayWindow,
  type SupplierWindowRule,
} from "../lib/repair-scheduling";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
const H = (h: number) => h * 60; // hours → minutes

// --- constants --------------------------------------------------------------
ok("a day is 1440 minutes", MINUTES_PER_DAY === 1440);
ok("default min partial is 60", DEFAULT_MIN_PARTIAL_MINUTES === 60);
ok("3 arrival presets", COMMON_ARRIVAL_WINDOW_PRESETS.length === 3);
ok("morning preset is 8-12", COMMON_ARRIVAL_WINDOW_PRESETS[0].start_minute === 480 && COMMON_ARRIVAL_WINDOW_PRESETS[0].end_minute === 720);

// --- date validity ----------------------------------------------------------
ok("valid date", isValidIsoDate("2026-06-30"));
ok("leap day 2024 valid", isValidIsoDate("2024-02-29"));
ok("non-leap 2026-02-29 invalid", !isValidIsoDate("2026-02-29"));
ok("month 13 invalid", !isValidIsoDate("2026-13-01"));
ok("junk invalid", !isValidIsoDate("nope"));
ok("empty invalid", !isValidIsoDate(""));

// --- window validation ------------------------------------------------------
ok("valid window ok", validateDayWindow({ date: "2026-06-30", start_minute: 480, end_minute: 720 }).ok);
ok("bad date code", (validateDayWindow({ date: "x", start_minute: 1, end_minute: 2 }) as { code: string }).code === "date");
ok("start>=end code order", (validateDayWindow({ date: "2026-06-30", start_minute: 720, end_minute: 720 }) as { code: string }).code === "order");
ok("out of range code", (validateDayWindow({ date: "2026-06-30", start_minute: -1, end_minute: 60 }) as { code: string }).code === "range");
ok("over 1440 code range", (validateDayWindow({ date: "2026-06-30", start_minute: 0, end_minute: 1500 }) as { code: string }).code === "range");
ok("non-integer code range", (validateDayWindow({ date: "2026-06-30", start_minute: 1.5, end_minute: 60 }) as { code: string }).code === "range");
{
  const v = validateDayWindow({ date: " 2026-06-30 ", start_minute: 480, end_minute: 720, label: "  AM  " });
  ok("valid trims date + label", v.ok && v.value.date === "2026-06-30" && v.value.label === "AM");
}
ok(
  "normalizeWindows drops invalid",
  normalizeWindows([
    { date: "2026-06-30", start_minute: 480, end_minute: 720 },
    { date: "bad", start_minute: 1, end_minute: 2 },
    { date: "2026-06-30", start_minute: 600, end_minute: 600 },
  ]).length === 1,
);

// --- supplier rules + expansion ---------------------------------------------
// 2026-06-30 is a Tuesday (weekday 2); 2026-07-01 Wed (3); 2026-07-04 Sat (6).
ok("weekday of 2026-06-30 is Tue(2)", weekdayOfIsoDate("2026-06-30") === 2);
ok("weekday of 2026-07-04 is Sat(6)", weekdayOfIsoDate("2026-07-04") === 6);
ok("weekday null on junk", weekdayOfIsoDate("bad") === null);
ok("valid rule", isValidSupplierRule({ weekday: 2, start_minute: 480, end_minute: 720 }));
ok("null-weekday (any day) rule valid", isValidSupplierRule({ weekday: null, start_minute: 480, end_minute: 720 }));
ok("Saturday(6) rule valid (weekends first-class)", isValidSupplierRule({ weekday: 6, start_minute: 480, end_minute: 720 }));
ok("rule weekday 7 invalid", !isValidSupplierRule({ weekday: 7, start_minute: 480, end_minute: 720 }));
ok("rule start>=end invalid", !isValidSupplierRule({ weekday: 2, start_minute: 720, end_minute: 480 }));
{
  const rules: SupplierWindowRule[] = [
    { weekday: 2, start_minute: H(8), end_minute: H(12), label: "Tue AM" }, // Tuesdays
    { weekday: 3, start_minute: H(13), end_minute: H(16) }, // Wednesdays
  ];
  const exp = expandRulesToDates(rules, ["2026-06-30", "2026-07-01", "2026-07-04"]);
  ok("expansion yields 2 windows (Tue + Wed, not Sat)", exp.length === 2);
  ok("Tue window carries label + date", exp[0].date === "2026-06-30" && exp[0].label === "Tue AM");
  ok("Wed window expanded", exp[1].date === "2026-07-01" && exp[1].start_minute === H(13));
  ok("expansion skips invalid rules", expandRulesToDates([{ weekday: 9, start_minute: 1, end_minute: 2 }], ["2026-06-30"]).length === 0);
  ok("expansion skips bad dates", expandRulesToDates(rules, ["bad-date"]).length === 0);

  // A null-weekday rule applies to EVERY date (incl. the Saturday).
  const anyDay = expandRulesToDates(
    [{ weekday: null, start_minute: H(8), end_minute: H(12), label: "Any day AM" }],
    ["2026-06-30", "2026-07-01", "2026-07-04"],
  );
  ok("null-weekday rule applies to all 3 dates incl. Saturday", anyDay.length === 3 && anyDay[2].date === "2026-07-04");

  // A Saturday-only rule lands only on the Saturday.
  const satOnly = expandRulesToDates(
    [{ weekday: 6, start_minute: H(9), end_minute: H(13) }],
    ["2026-06-30", "2026-07-04"],
  );
  ok("Saturday(6) rule lands only on the Saturday", satOnly.length === 1 && satOnly[0].date === "2026-07-04");
}

// --- window-list maintenance ------------------------------------------------
{
  const k = windowKey({ date: "2026-06-30", start_minute: H(8), end_minute: H(12) });
  ok("windowKey is date|start|end", k === "2026-06-30|480|720");
}
{
  const list: DayWindow[] = [
    { date: "2026-07-01", start_minute: H(13), end_minute: H(16) },
    { date: "2026-06-30", start_minute: H(8), end_minute: H(12) },
  ];
  ok("sortWindows orders by date then start", sortWindows(list)[0].date === "2026-06-30");
}
{
  const dup: DayWindow[] = [
    { date: "2026-06-30", start_minute: H(8), end_minute: H(12), label: "AM" },
    { date: "2026-06-30", start_minute: H(8), end_minute: H(12), label: "dup" },
    { date: "2026-06-30", start_minute: H(13), end_minute: H(16) },
  ];
  const d = dedupeWindows(dup);
  ok("dedupeWindows drops the duplicate", d.length === 2 && d[0].label === "AM");
}
{
  // 2026-06-30 is Tuesday(2); 2026-07-07 is also Tuesday(2).
  const rules = windowsToRules([
    { date: "2026-06-30", start_minute: H(8), end_minute: H(12), label: "AM" },
    { date: "2026-07-07", start_minute: H(8), end_minute: H(12) }, // same weekday+time → 1 rule
    { date: "2026-07-01", start_minute: H(13), end_minute: H(16) }, // Wed
  ]);
  ok("windowsToRules collapses same weekday+time", rules.length === 2);
  ok("windowsToRules keeps weekday + label", rules[0].weekday === 2 && rules[0].label === "AM");
}
ok(
  "datesInPlay is distinct + sorted",
  JSON.stringify(
    datesInPlay([
      { date: "2026-07-01", start_minute: 1, end_minute: 2 },
      { date: "2026-06-30", start_minute: 1, end_minute: 2 },
      { date: "2026-07-01", start_minute: 3, end_minute: 4 },
    ]),
  ) === JSON.stringify(["2026-06-30", "2026-07-01"]),
);

// --- interval algebra -------------------------------------------------------
ok(
  "mergeIntervals merges overlapping + touching",
  JSON.stringify(
    mergeIntervals([
      { start_minute: 60, end_minute: 120 },
      { start_minute: 120, end_minute: 180 }, // touching
      { start_minute: 100, end_minute: 110 }, // inside
      { start_minute: 300, end_minute: 360 }, // separate
    ]),
  ) === JSON.stringify([
    { start_minute: 60, end_minute: 180 },
    { start_minute: 300, end_minute: 360 },
  ]),
);
ok("mergeIntervals drops zero-length", mergeIntervals([{ start_minute: 60, end_minute: 60 }]).length === 0);
ok(
  "intersectInterval clips to availability",
  JSON.stringify(
    intersectInterval({ start_minute: H(8), end_minute: H(12) }, [
      { start_minute: H(9), end_minute: H(10) },
      { start_minute: H(11), end_minute: H(14) },
    ]),
  ) === JSON.stringify([
    { start_minute: H(9), end_minute: H(10) },
    { start_minute: H(11), end_minute: H(12) },
  ]),
);
ok("intersectInterval empty when no avail", intersectInterval({ start_minute: H(8), end_minute: H(12) }, []).length === 0);
ok(
  "subtractCovered finds the gap",
  JSON.stringify(
    subtractCovered({ start_minute: H(8), end_minute: H(12) }, [{ start_minute: H(9), end_minute: H(10) }]),
  ) === JSON.stringify([
    { start_minute: H(8), end_minute: H(9) },
    { start_minute: H(10), end_minute: H(12) },
  ]),
);
ok("subtractCovered empty when fully covered", subtractCovered({ start_minute: H(8), end_minute: H(12) }, [{ start_minute: H(7), end_minute: H(13) }]).length === 0);
ok("intervalMinutes sums", intervalMinutes([{ start_minute: 0, end_minute: 60 }, { start_minute: 120, end_minute: 150 }]) === 90);

// --- the matcher (the heart) ------------------------------------------------
const D = "2026-06-30";
const supplier: DayWindow[] = [
  { date: D, start_minute: H(8), end_minute: H(12), label: "Morning" }, // 8-12
  { date: D, start_minute: H(13), end_minute: H(16), label: "Afternoon" }, // 1-4
  { date: D, start_minute: H(17), end_minute: H(21), label: "Evening" }, // 5-9
];

// Tenant free all morning + part of the afternoon, nothing in the evening.
const tenant: DayWindow[] = [
  { date: D, start_minute: H(7), end_minute: H(12) }, // covers all of Morning
  { date: D, start_minute: H(13), end_minute: H(14) }, // only 1 hr of Afternoon
];

{
  const m = matchSupplierWindows(supplier, tenant);
  ok("3 matches returned", m.length === 3);
  ok("Morning AVAILABLE (whole block covered)", m[0].window.label === "Morning" && m[0].status === "available" && m[0].gaps.length === 0);
  ok("Afternoon PARTIAL (only 1 of 3 hrs)", m[1].window.label === "Afternoon" && m[1].status === "partial" && m[1].coveredMinutes === 60);
  ok("Afternoon gap is 2-4pm", JSON.stringify(m[1].gaps) === JSON.stringify([{ start_minute: H(14), end_minute: H(16) }]));
  ok("Evening UNAVAILABLE (no overlap)", m[2].window.label === "Evening" && m[2].status === "unavailable" && m[2].coveredMinutes === 0);
}

// minPartialMinutes raises the partial bar above the 60-min afternoon coverage.
{
  const m = matchSupplierWindows(supplier, tenant, { minPartialMinutes: 90 });
  ok("Afternoon drops to unavailable under a 90-min bar", m[1].status === "unavailable");
}

// Containment semantic: an arrival block partly covered is NOT available.
{
  const m = matchSupplierWindows(
    [{ date: D, start_minute: H(8), end_minute: H(12), label: "AM" }],
    [{ date: D, start_minute: H(8), end_minute: H(11) }], // 1 hr short at the end
  );
  ok("partly-covered arrival block is NOT available", m[0].status === "partial");
  ok("the uncovered tail is the gap", JSON.stringify(m[0].gaps) === JSON.stringify([{ start_minute: H(11), end_minute: H(12) }]));
}

// availableSupplierWindows filters to fully-bookable only.
{
  const avail = availableSupplierWindows(supplier, tenant);
  ok("only Morning is directly bookable", avail.length === 1 && avail[0].window.label === "Morning");
}

// Different dates never cross-match.
{
  const m = matchSupplierWindows(
    [{ date: "2026-06-30", start_minute: H(8), end_minute: H(12) }],
    [{ date: "2026-07-01", start_minute: H(8), end_minute: H(12) }],
  );
  ok("supplier window on a date with no tenant availability is unavailable", m[0].status === "unavailable");
}

// Tenant windows on the same date are unioned before matching.
{
  const m = matchSupplierWindows(
    [{ date: D, start_minute: H(8), end_minute: H(12) }],
    [
      { date: D, start_minute: H(8), end_minute: H(10) },
      { date: D, start_minute: H(10), end_minute: H(12) }, // touches → union covers 8-12
    ],
  );
  ok("two touching tenant windows union to cover the block", m[0].status === "available");
}

// --- generic overlap (exact-time supplier) ----------------------------------
{
  const c = intersectWindows(
    [{ date: D, start_minute: H(8), end_minute: H(12) }],
    [{ date: D, start_minute: H(10), end_minute: H(14) }],
  );
  ok("overlap is 10-12", c.length === 1 && c[0].date === D && c[0].start_minute === H(10) && c[0].end_minute === H(12));
}
{
  const c = intersectWindows(
    [{ date: D, start_minute: H(8), end_minute: H(12) }],
    [{ date: D, start_minute: H(11), end_minute: H(14) }],
    { minOverlapMinutes: 90 }, // 60-min overlap is below the bar
  );
  ok("overlap below minOverlap is dropped", c.length === 0);
}
ok(
  "intersectWindows no overlap on different dates",
  intersectWindows(
    [{ date: "2026-06-30", start_minute: H(8), end_minute: H(12) }],
    [{ date: "2026-07-01", start_minute: H(8), end_minute: H(12) }],
  ).length === 0,
);

// --- formatting -------------------------------------------------------------
ok("formatClock 8am", formatClock(H(8)) === "8:00 AM");
ok("formatClock noon", formatClock(H(12)) === "12:00 PM");
ok("formatClock 1:30pm", formatClock(13 * 60 + 30) === "1:30 PM");
ok("formatClock midnight 0", formatClock(0) === "12:00 AM");
ok("formatClock 1440 → midnight", formatClock(1440) === "12:00 AM");
ok("formatWindowClock range", formatWindowClock(H(8), H(12)) === "8:00 AM - 12:00 PM");
ok("formatIsoDateShort", formatIsoDateShort("2026-06-30") === "Jun 30");
ok("formatIsoDateShort empty on junk", formatIsoDateShort("bad") === "");
ok("formatDayWindow", formatDayWindow({ date: "2026-06-30", start_minute: H(8), end_minute: H(12) }) === "Jun 30: 8:00 AM - 12:00 PM");
ok("status label available", matchStatusLabel("available") === "Works for both");
ok("status label fallback", matchStatusLabel("weird") === "weird");
ok("status tone available green", matchStatusTone("available") === "green");
ok("status tone fallback gray", matchStatusTone("weird") === "gray");

// --- summary ----------------------------------------------------------------
console.log(`\nrepair-scheduling: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
