// Unit tests for the per-tenancy lease-violation follow-up status math + reminder
// sweep selection (S383). Run: npx tsx scripts/test-lease-violations.ts
import {
  FOLLOWUP_LEAD_DAYS,
  FOLLOWUP_ACTIONABLE_STATUSES,
  FOLLOWUP_URGENCY,
  VIOLATION_TYPES,
  VIOLATION_STATUSES,
  isViolationType,
  isViolationLifecycle,
  violationTypeLabel,
  violationLifecycleLabel,
  followupAnchor,
  followupStatus,
  followupStatusFor,
  isActionableFollowupStatus,
  daysBetween,
  type ViolationInput,
} from "../lib/lease-violations";
import { decideViolationNudge } from "../lib/lease-violations-sweep";

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
ok("default lead window is 3 days", FOLLOWUP_LEAD_DAYS === 3);
ok(
  "actionable band = approaching + overdue",
  FOLLOWUP_ACTIONABLE_STATUSES.slice().sort().join(",") ===
    ["approaching", "overdue"].join(","),
);
ok("urgency: overdue before approaching", FOLLOWUP_URGENCY.overdue < FOLLOWUP_URGENCY.approaching);

// --- type + lifecycle vocab -------------------------------------------------
ok("10 violation types", VIOLATION_TYPES.length === 10);
ok("late_rent is a type", isViolationType("late_rent"));
ok("garbage is not a type", !isViolationType("nope"));
ok("type label maps", violationTypeLabel("property_damage") === "Property damage");
ok("type label falls back to Other", violationTypeLabel("nope") === "Other");
ok("4 lifecycle states", VIOLATION_STATUSES.length === 4);
ok("escalated is a lifecycle", isViolationLifecycle("escalated"));
ok("lifecycle label maps", violationLifecycleLabel("closed") === "Closed");
ok("lifecycle label falls back to Open", violationLifecycleLabel("") === "Open");

// --- date helper ------------------------------------------------------------
ok("daysBetween counts forward", daysBetween("2026-06-29", "2026-07-02") === 3);
ok("daysBetween is negative in the past", daysBetween("2026-06-29", "2026-06-26") === -3);
ok("daysBetween null on junk", daysBetween("2026-13-40", "2026-07-09") === null);

// --- anchor (open + deadline) -----------------------------------------------
ok(
  "anchor uses remedy_due_on for an open record",
  followupAnchor({ status: "open", remedy_due_on: "2026-07-01" }) === "2026-07-01",
);
ok("anchor null when no deadline", followupAnchor({ status: "open" }) === null);
ok("anchor null on malformed deadline", followupAnchor({ status: "open", remedy_due_on: "soon" }) === null);
ok(
  "anchor null when record is not open (remedied)",
  followupAnchor({ status: "remedied", remedy_due_on: "2026-07-01" }) === null,
);
ok(
  "anchor null when closed even with a deadline",
  followupAnchor({ status: "closed", remedy_due_on: "2026-07-01" }) === null,
);
ok(
  "missing status defaults to open (so anchor resolves)",
  followupAnchor({ remedy_due_on: "2026-07-01" }) === "2026-07-01",
);

// --- status bands (default 3-day window) ------------------------------------
ok("no deadline => none", followupStatus(null, TODAY) === "none");
ok("far future => ok", followupStatus("2026-12-01", TODAY) === "ok");
ok("10 days out => ok (outside 3-day window)", followupStatus("2026-07-09", TODAY) === "ok");
ok("2 days out => approaching", followupStatus("2026-07-01", TODAY) === "approaching");
ok("exactly the lead edge (3d) => approaching", followupStatus("2026-07-02", TODAY) === "approaching");
ok("today is the deadline => overdue", followupStatus("2026-06-29", TODAY) === "overdue");
ok("past the deadline => overdue", followupStatus("2026-06-01", TODAY) === "overdue");

// statusFor straight from a record input
ok(
  "statusFor overdue open record",
  followupStatusFor({ status: "open", remedy_due_on: "2026-06-01" }, TODAY) === "overdue",
);
ok(
  "statusFor none for a closed record past deadline",
  followupStatusFor({ status: "closed", remedy_due_on: "2026-06-01" }, TODAY) === "none",
);

// custom lead window is honoured
ok("custom 14-day window flips 10d-out to approaching", followupStatus("2026-07-09", TODAY, 14) === "approaching");

// --- actionable predicate ---------------------------------------------------
ok("isActionable approaching", isActionableFollowupStatus("approaching"));
ok("isActionable overdue", isActionableFollowupStatus("overdue"));
ok("not actionable ok", !isActionableFollowupStatus("ok"));
ok("not actionable none", !isActionableFollowupStatus("none"));

// --- nudge decision + idempotency -------------------------------------------
// Helper: derive anchor + status from a record input as of TODAY, then decide.
function decide(d: ViolationInput, lastNudgedFor: string | null, force = false) {
  const remedyDueOn = followupAnchor(d);
  const status = followupStatusFor(d, TODAY);
  return decideViolationNudge({ remedyDueOn, status, lastNudgedFor, force });
}

// An overdue open violation — actionable, never nudged -> nudge + stamp the deadline.
const overdue: ViolationInput = { status: "open", remedy_due_on: "2026-06-01" };
const d1 = decide(overdue, null);
ok("overdue violation nudges", d1.nudge && d1.reason === "due");
ok("overdue stampFor is the deadline", d1.stampFor === "2026-06-01");

// Already nudged for this deadline -> no re-nudge (the periodic pinger is idempotent).
const d2 = decide(overdue, "2026-06-01");
ok("already-nudged is suppressed", !d2.nudge && d2.reason === "already_nudged");

// force bypasses the gate (still stamps).
const d3 = decide(overdue, "2026-06-01", true);
ok("force re-nudges", d3.nudge && d3.stampFor === "2026-06-01");

// Marking it remedied silences the reminder (anchor goes null -> not actionable).
const remedied: ViolationInput = { status: "remedied", remedy_due_on: "2026-06-01" };
const d4 = decide(remedied, null);
ok("remedied record does not nudge", !d4.nudge && d4.reason === "no_remedy_deadline");

// Editing the deadline (new date) re-arms: old stamp no longer matches.
const movedDeadline: ViolationInput = { status: "open", remedy_due_on: "2026-06-25" };
const d5 = decide(movedDeadline, "2026-06-01"); // stamp from the old deadline
ok("moved-deadline open violation re-arms", d5.nudge && d5.stampFor === "2026-06-25");

// An approaching open violation with no prior stamp nudges once.
const approaching: ViolationInput = { status: "open", remedy_due_on: "2026-07-01" };
const d6 = decide(approaching, null);
ok("approaching violation nudges", d6.nudge && d6.stampFor === "2026-07-01");

// An ok (far-future) open violation never nudges yet.
const okItem: ViolationInput = { status: "open", remedy_due_on: "2026-12-01" };
const d7 = decide(okItem, null);
ok("ok violation does not nudge", !d7.nudge);

// No deadline -> no nudge, no stamp (just a logged record).
const d8 = decide({ status: "open", remedy_due_on: null }, null);
ok("no deadline does not nudge", !d8.nudge && d8.stampFor === null && d8.reason === "no_remedy_deadline");

// --- summary ----------------------------------------------------------------
console.log(`\nlease-violations: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
