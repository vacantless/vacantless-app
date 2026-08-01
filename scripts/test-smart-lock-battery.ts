// Unit tests for the smart-lock battery reminder cadence + sweep selection.
// Run: npx tsx scripts/test-smart-lock-battery.ts
import {
  SMART_LOCK_BATTERY_INTERVAL_MONTHS,
  isSmartLockBatteryReminderDue,
  nextSmartLockBatteryReminderDueAt,
} from "../lib/smart-lock-battery";
import {
  decideSmartLockBatteryReminder,
  type SmartLockUnitRow,
} from "../lib/smart-lock-battery-sweep";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const NOW = "2026-08-01T12:00:00.000Z";

// --- pure cadence -----------------------------------------------------------
ok("interval is six months", SMART_LOCK_BATTERY_INTERVAL_MONTHS === 6);
ok("never reminded is due", isSmartLockBatteryReminderDue({ lastSentAt: null, now: NOW }));
ok(
  "invalid last reminder is due",
  isSmartLockBatteryReminderDue({ lastSentAt: "not-a-date", now: NOW }),
);
ok(
  "not due before six months",
  !isSmartLockBatteryReminderDue({
    lastSentAt: "2026-02-02T12:00:00.000Z",
    now: "2026-08-01T12:00:00.000Z",
  }),
);
ok(
  "due at six months",
  isSmartLockBatteryReminderDue({
    lastSentAt: "2026-02-01T12:00:00.000Z",
    now: "2026-08-01T12:00:00.000Z",
  }),
);
ok(
  "due after six months",
  isSmartLockBatteryReminderDue({
    lastSentAt: "2026-01-31T12:00:00.000Z",
    now: "2026-08-01T12:00:00.000Z",
  }),
);
ok(
  "next due is six calendar months out",
  nextSmartLockBatteryReminderDueAt("2026-02-01T12:00:00.000Z")?.toISOString() ===
    "2026-08-01T12:00:00.000Z",
);

// --- sweep selection / idempotency -----------------------------------------
let unitSeq = 0;
function unit(
  hasSmartLock: boolean,
  lastSentAt: string | null,
): SmartLockUnitRow {
  return {
    id: `unit-${++unitSeq}`,
    address: "506 Manning Ave - Unit 2",
    has_smart_lock: hasSmartLock,
    last_smart_lock_battery_reminder_at: lastSentAt,
  };
}

function dueCount(rows: SmartLockUnitRow[], now = NOW): number {
  return rows.filter(
    (row) => decideSmartLockBatteryReminder({ unit: row, now }).nudge,
  ).length;
}

ok("dark by data: no flagged units sends zero", dueCount([unit(false, null), unit(false, NOW)]) === 0);

const first = unit(true, null);
const d1 = decideSmartLockBatteryReminder({ unit: first, now: NOW });
ok("flagged never-reminded unit nudges", d1.nudge && d1.reason === "due");
ok("decision stamps at now", d1.stampAt === NOW);

const afterStamp = { ...first, last_smart_lock_battery_reminder_at: d1.stampAt };
const d2 = decideSmartLockBatteryReminder({ unit: afterStamp, now: NOW });
ok("same-day re-run is suppressed", !d2.nudge && d2.reason === "already_sent");
ok("idempotent after stamp sends zero", dueCount([afterStamp], NOW) === 0);

const stale = unit(true, "2026-01-01T00:00:00.000Z");
const d3 = decideSmartLockBatteryReminder({ unit: stale, now: NOW });
ok("stale stamp re-arms after interval", d3.nudge && d3.stampAt === NOW);

const forced = decideSmartLockBatteryReminder({
  unit: afterStamp,
  now: NOW,
  force: true,
});
ok("force bypasses already-sent gate", forced.nudge && forced.reason === "due");

console.log(`\nsmart-lock-battery: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
