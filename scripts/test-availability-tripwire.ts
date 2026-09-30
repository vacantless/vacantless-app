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
  describeTripwire,
  formatOpenDayList,
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

// S699: the alert email names the open days.
ok("dayList: empty reads none", formatOpenDayList([]) === "none");
ok("dayList: one day", formatOpenDayList(["2026-10-02"]) === "Fri, Oct 2");
ok("dayList: two days", formatOpenDayList(["2026-10-02", "2026-10-03"]) === "Fri, Oct 2 and Sat, Oct 3");
ok("dayList: three days", formatOpenDayList(["2026-10-02", "2026-10-03", "2026-10-05"]) === "Fri, Oct 2; Sat, Oct 3 and Mon, Oct 5");
ok("dayList: junk ignored", formatOpenDayList(["nope"]) === "none");

{
  const d = describeTripwire({ open: 12, dayKeys: ["2026-10-02"], windowDays: 7 });
  ok("describe: one day headline", d.headline === "viewings can be booked on only 1 day in the next 7 days");
  ok("describe: one day names the day and count", d.summary.includes("Fri, Oct 2 (12 open viewing times)"));
  const z = describeTripwire({ open: 0, dayKeys: [], windowDays: 7 });
  ok("describe: zero", z.headline === "no viewing times renters can book in the next 7 days" && !z.summary.includes("none"));
  const f = describeTripwire({ open: 2, dayKeys: ["2026-10-02", "2026-10-03"], windowDays: 7 });
  ok("describe: few times", f.headline === "only 2 open viewing times left in the next 7 days" && f.summary.endsWith("on Fri, Oct 2 and Sat, Oct 3."));
  const one = describeTripwire({ open: 1, dayKeys: ["2026-10-02"], windowDays: 1 });
  ok("describe: singulars", one.summary.includes("the next 1 day:") && one.summary.includes("(1 open viewing time)"));
  ok("describe: no em dashes", ![d, z, f, one].some((x) => /\u2014/.test(x.headline + x.summary)));
}

console.log(`\navailability-tripwire: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
