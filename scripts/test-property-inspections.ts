// Unit tests for the per-tenancy property-inspection due status math + reminder
// sweep selection (S385). Run: npx tsx scripts/test-property-inspections.ts
import {
  INSPECTION_LEAD_DAYS,
  INSPECTION_DUE_ACTIONABLE_STATUSES,
  INSPECTION_URGENCY,
  INSPECTION_TYPES,
  INSPECTION_STATUSES,
  isInspectionType,
  isInspectionLifecycle,
  inspectionTypeLabel,
  inspectionLifecycleLabel,
  reminderAnchor,
  dueStatus,
  dueStatusFor,
  isActionableInspectionDueStatus,
  daysBetween,
  type InspectionInput,
} from "../lib/property-inspections";
import { decideInspectionNudge } from "../lib/property-inspections-sweep";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TODAY = "2026-06-29";

// --- constants --------------------------------------------------------------
ok("default lead window is 7 days", INSPECTION_LEAD_DAYS === 7);
ok(
  "actionable band = approaching + overdue",
  INSPECTION_DUE_ACTIONABLE_STATUSES.slice().sort().join(",") ===
    ["approaching", "overdue"].join(","),
);
ok("urgency: overdue before approaching", INSPECTION_URGENCY.overdue < INSPECTION_URGENCY.approaching);

// --- type + lifecycle vocab -------------------------------------------------
ok("4 inspection types", INSPECTION_TYPES.length === 4);
ok("move_in is a type", isInspectionType("move_in"));
ok("garbage is not a type", !isInspectionType("nope"));
ok("type label maps", inspectionTypeLabel("move_out") === "Move-out inspection");
ok("type label falls back to Other", inspectionTypeLabel("nope") === "Other inspection");
ok("4 lifecycle states", INSPECTION_STATUSES.length === 4);
ok("completed is a lifecycle", isInspectionLifecycle("completed"));
ok("lifecycle label maps", inspectionLifecycleLabel("skipped") === "Skipped");
ok("lifecycle label falls back to Scheduled", inspectionLifecycleLabel("") === "Scheduled");

// --- date helper ------------------------------------------------------------
ok("daysBetween counts forward", daysBetween("2026-06-29", "2026-07-06") === 7);
ok("daysBetween is negative in the past", daysBetween("2026-06-29", "2026-06-22") === -7);
ok("daysBetween null on junk", daysBetween("2026-13-40", "2026-07-09") === null);

// --- anchor (scheduled + date) ----------------------------------------------
ok(
  "anchor uses scheduled_for for a scheduled record",
  reminderAnchor({ status: "scheduled", scheduled_for: "2026-07-01" }) === "2026-07-01",
);
ok("anchor null when no date", reminderAnchor({ status: "scheduled" }) === null);
ok("anchor null on malformed date", reminderAnchor({ status: "scheduled", scheduled_for: "soon" }) === null);
ok(
  "anchor null when record is completed",
  reminderAnchor({ status: "completed", scheduled_for: "2026-07-01" }) === null,
);
ok(
  "anchor null when canceled even with a date",
  reminderAnchor({ status: "canceled", scheduled_for: "2026-07-01" }) === null,
);
ok(
  "missing status defaults to scheduled (so anchor resolves)",
  reminderAnchor({ scheduled_for: "2026-07-01" }) === "2026-07-01",
);

// --- status bands (default 7-day window) ------------------------------------
ok("no date => none", dueStatus(null, TODAY) === "none");
ok("far future => ok", dueStatus("2026-12-01", TODAY) === "ok");
ok("20 days out => ok (outside 7-day window)", dueStatus("2026-07-19", TODAY) === "ok");
ok("5 days out => approaching", dueStatus("2026-07-04", TODAY) === "approaching");
ok("exactly the lead edge (7d) => approaching", dueStatus("2026-07-06", TODAY) === "approaching");
ok("today is the date => overdue", dueStatus("2026-06-29", TODAY) === "overdue");
ok("past the date => overdue", dueStatus("2026-06-01", TODAY) === "overdue");

// statusFor straight from a record input
ok(
  "statusFor overdue scheduled record",
  dueStatusFor({ status: "scheduled", scheduled_for: "2026-06-01" }, TODAY) === "overdue",
);
ok(
  "statusFor none for a completed record past date",
  dueStatusFor({ status: "completed", scheduled_for: "2026-06-01" }, TODAY) === "none",
);

// custom lead window is honoured
ok("custom 30-day window flips 20d-out to approaching", dueStatus("2026-07-19", TODAY, 30) === "approaching");

// --- actionable predicate ---------------------------------------------------
ok("isActionable approaching", isActionableInspectionDueStatus("approaching"));
ok("isActionable overdue", isActionableInspectionDueStatus("overdue"));
ok("not actionable ok", !isActionableInspectionDueStatus("ok"));
ok("not actionable none", !isActionableInspectionDueStatus("none"));

// --- nudge decision + idempotency -------------------------------------------
// Helper: derive anchor + status from a record input as of TODAY, then decide.
function decide(d: InspectionInput, lastNudgedFor: string | null, force = false) {
  const scheduledFor = reminderAnchor(d);
  const status = dueStatusFor(d, TODAY);
  return decideInspectionNudge({ scheduledFor, status, lastNudgedFor, force });
}

// An overdue scheduled inspection — actionable, never nudged -> nudge + stamp.
const overdue: InspectionInput = { status: "scheduled", scheduled_for: "2026-06-01" };
const d1 = decide(overdue, null);
ok("overdue inspection nudges", d1.nudge && d1.reason === "due");
ok("overdue stampFor is the date", d1.stampFor === "2026-06-01");

// Already nudged for this date -> no re-nudge (the periodic pinger is idempotent).
const d2 = decide(overdue, "2026-06-01");
ok("already-nudged is suppressed", !d2.nudge && d2.reason === "already_nudged");

// force bypasses the gate (still stamps).
const d3 = decide(overdue, "2026-06-01", true);
ok("force re-nudges", d3.nudge && d3.stampFor === "2026-06-01");

// Marking it completed silences the reminder (anchor goes null -> not actionable).
const completed: InspectionInput = { status: "completed", scheduled_for: "2026-06-01" };
const d4 = decide(completed, null);
ok("completed record does not nudge", !d4.nudge && d4.reason === "no_planned_date");

// Rescheduling (new date) re-arms: old stamp no longer matches.
const moved: InspectionInput = { status: "scheduled", scheduled_for: "2026-06-25" };
const d5 = decide(moved, "2026-06-01"); // stamp from the old date
ok("rescheduled inspection re-arms", d5.nudge && d5.stampFor === "2026-06-25");

// An approaching scheduled inspection with no prior stamp nudges once.
const approaching: InspectionInput = { status: "scheduled", scheduled_for: "2026-07-04" };
const d6 = decide(approaching, null);
ok("approaching inspection nudges", d6.nudge && d6.stampFor === "2026-07-04");

// An ok (far-future) scheduled inspection never nudges yet.
const okItem: InspectionInput = { status: "scheduled", scheduled_for: "2026-12-01" };
const d7 = decide(okItem, null);
ok("ok inspection does not nudge", !d7.nudge);

// No date -> no nudge, no stamp (just a logged record).
const d8 = decide({ status: "scheduled", scheduled_for: null }, null);
ok("no date does not nudge", !d8.nudge && d8.stampFor === null && d8.reason === "no_planned_date");

// --- summary ----------------------------------------------------------------
console.log(`\nproperty-inspections: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
