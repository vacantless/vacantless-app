// Unit tests for the pure weekly viewing-times reminder logic.
// Run: npx tsx scripts/test-viewing-reminder.ts
import type { Availability } from "../lib/booking";
import {
  VIEWING_REMINDER_MIN_OPEN_SLOTS,
  countOpenViewingSlotsNext7,
  isViewingWeekEmpty,
  openViewingDaysNext7,
  shouldSendViewingReminder,
} from "../lib/viewing-reminder";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TZ = "America/Toronto";

// Sunday 2026-07-19 17:30 EDT.
const sundayAfterHour = Date.UTC(2026, 6, 19, 21, 30, 0);
const due = shouldSendViewingReminder({
  nowMs: sundayAfterHour,
  tz: TZ,
  weekday: 0,
  hour: 17,
  lastSentOn: null,
});
ok("gate: due on chosen weekday after hour", due.send && due.reason === "due");
ok("gate: carries local date", due.localDate === "2026-07-19");

ok(
  "gate: wrong weekday skips",
  shouldSendViewingReminder({
    nowMs: Date.UTC(2026, 6, 18, 21, 30, 0),
    tz: TZ,
    weekday: 0,
    hour: 17,
    lastSentOn: null,
  }).reason === "wrong_day",
);

ok(
  "gate: before hour skips",
  shouldSendViewingReminder({
    nowMs: Date.UTC(2026, 6, 19, 20, 30, 0),
    tz: TZ,
    weekday: 0,
    hour: 17,
    lastSentOn: null,
  }).reason === "before_hour",
);

ok(
  "gate: already sent today skips",
  shouldSendViewingReminder({
    nowMs: sundayAfterHour,
    tz: TZ,
    weekday: 0,
    hour: 17,
    lastSentOn: "2026-07-19",
  }).reason === "already_sent",
);

ok(
  "gate: already sent within reminder week skips",
  shouldSendViewingReminder({
    nowMs: sundayAfterHour,
    tz: TZ,
    weekday: 0,
    hour: 17,
    lastSentOn: "2026-07-13",
  }).reason === "already_sent",
);

ok(
  "gate: prior week can send again",
  shouldSendViewingReminder({
    nowMs: sundayAfterHour,
    tz: TZ,
    weekday: 0,
    hour: 17,
    lastSentOn: "2026-07-12",
  }).send === true,
);

const baseAvailability = (over: Partial<Availability> = {}): Availability => ({
  timezone: TZ,
  slot_minutes: 30,
  lead_hours: 0,
  horizon_days: 14,
  rules: [],
  booked: [],
  days_off: [],
  overrides: [],
  ...over,
});

// Monday 2026-07-20 09:00 EDT.
const mondayMorning = new Date(Date.UTC(2026, 6, 20, 13, 0, 0));

const covered = baseAvailability({
  rules: [{ weekday: 1, start_minute: 10 * 60, end_minute: 11 * 60 }],
});
ok("empty: covered weekly window is not empty", isViewingWeekEmpty(covered, mondayMorning) === false);
ok("empty: covered window has open slots", countOpenViewingSlotsNext7(covered, mondayMorning) >= VIEWING_REMINDER_MIN_OPEN_SLOTS);
ok(
  "empty: open day list includes covered date",
  JSON.stringify(openViewingDaysNext7(covered, mondayMorning)) === JSON.stringify(["2026-07-20"]),
);

ok(
  "empty: no rules/no overrides is empty",
  isViewingWeekEmpty(baseAvailability(), mondayMorning) === true,
);

const everyDayRules = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  start_minute: 10 * 60,
  end_minute: 11 * 60,
}));
ok(
  "empty: all next-seven days off is empty",
  isViewingWeekEmpty(
    baseAvailability({
      rules: everyDayRules,
      days_off: [
        "2026-07-20",
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
        "2026-07-24",
        "2026-07-25",
        "2026-07-26",
      ],
    }),
    mondayMorning,
  ) === true,
);

ok(
  "empty: override-only day in window is not empty",
  isViewingWeekEmpty(
    baseAvailability({
      overrides: [{ day: "2026-07-21", start_minute: 10 * 60, end_minute: 11 * 60 }],
    }),
    mondayMorning,
  ) === false,
);

ok(
  "empty: day off beats override",
  isViewingWeekEmpty(
    baseAvailability({
      days_off: ["2026-07-21"],
      overrides: [{ day: "2026-07-21", start_minute: 10 * 60, end_minute: 11 * 60 }],
    }),
    mondayMorning,
  ) === true,
);

console.log(`\nviewing-reminder: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
