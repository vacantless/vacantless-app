// Run: npx tsx scripts/test-availability-tripwire.ts
//
// Focused unit tests for the pure S513a availability-tripwire helper. The
// booked-aware counters themselves are covered by scripts/test-leasing-health.ts;
// this file verifies classification/debounce behavior and that the shared
// counter imports resolve through lib/availability-tripwire.ts.

import {
  classifyTripwire,
  countOpenBookableSlots,
  openBookableDays,
  shouldAlertTripwire,
  type TripwireSeverity,
} from "../lib/availability-tripwire";

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

function decision(args: {
  severity: TripwireSeverity;
  lastState: string | null;
  lastAlertOn: string | null;
}) {
  return shouldAlertTripwire({
    ...args,
    todayLocal: "2026-07-18",
  });
}

ok("imports: shared countOpenBookableSlots resolves", typeof countOpenBookableSlots === "function");
ok("imports: shared openBookableDays resolves", typeof openBookableDays === "function");

// --- severity classification ------------------------------------------------
ok(
  "classify: zero when no bookable slots",
  classifyTripwire({ open: 0, openDays: 0, thinSlots: 3 }) === "zero",
);
ok(
  "classify: thin by slot count",
  classifyTripwire({ open: 2, openDays: 3, thinSlots: 3 }) === "thin",
);
ok(
  "classify: thin by open-day count",
  classifyTripwire({ open: 4, openDays: 1, thinSlots: 3 }) === "thin",
);
ok(
  "classify: ok with enough slots across days",
  classifyTripwire({ open: 5, openDays: 3, thinSlots: 3 }) === "ok",
);

// --- edge-triggered debounce ------------------------------------------------
{
  const r = decision({ severity: "thin", lastState: null, lastAlertOn: null });
  ok("alert: null -> thin alerts", r.alert && r.nextLastState === "thin" && r.nextLastAlertOn === "2026-07-18");
}
{
  const r = decision({ severity: "thin", lastState: "ok", lastAlertOn: null });
  ok("alert: ok -> thin alerts", r.alert && r.nextLastState === "thin" && r.nextLastAlertOn === "2026-07-18");
}
{
  const r = decision({ severity: "thin", lastState: "thin", lastAlertOn: "2026-07-18" });
  ok("alert: thin -> thin same day suppresses", !r.alert && r.nextLastState === "thin" && r.nextLastAlertOn === "2026-07-18");
}
{
  const r = decision({ severity: "thin", lastState: "thin", lastAlertOn: "2026-07-17" });
  ok("alert: thin -> thin next day re-alerts", r.alert && r.nextLastState === "thin" && r.nextLastAlertOn === "2026-07-18");
}
{
  const r = decision({ severity: "zero", lastState: "thin", lastAlertOn: "2026-07-18" });
  ok("alert: thin -> zero escalates", r.alert && r.nextLastState === "zero" && r.nextLastAlertOn === "2026-07-18");
}
{
  const r = decision({ severity: "ok", lastState: "zero", lastAlertOn: "2026-07-18" });
  ok("alert: zero -> ok clears", !r.alert && r.nextLastState === "ok" && r.nextLastAlertOn === null);
}
{
  const r = decision({ severity: "zero", lastState: "ok", lastAlertOn: null });
  ok("alert: ok -> zero alerts", r.alert && r.nextLastState === "zero" && r.nextLastAlertOn === "2026-07-18");
}
{
  const r = decision({ severity: "thin", lastState: "zero", lastAlertOn: "2026-07-18" });
  ok("alert: zero -> thin improvement suppresses", !r.alert && r.nextLastState === "thin" && r.nextLastAlertOn === "2026-07-18");
}

console.log(`\navailability-tripwire: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
