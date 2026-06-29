// Unit tests for the per-tenancy renter's-insurance status math + reminder sweep
// selection (S382). Run: npx tsx scripts/test-tenancy-insurance.ts
import {
  INSURANCE_LEAD_DAYS,
  INSURANCE_ACTIONABLE_STATUSES,
  INSURANCE_URGENCY,
  insuranceExpiryAnchor,
  insuranceStatus,
  insuranceStatusFor,
  isActionableInsuranceStatus,
  daysBetween,
  formatCoverageCents,
  type InsuranceInput,
} from "../lib/tenancy-insurance";
import { decideInsuranceNudge } from "../lib/tenancy-insurance-sweep";

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
ok("default lead window is 30 days", INSURANCE_LEAD_DAYS === 30);
ok(
  "actionable band = expiring_soon + lapsed",
  INSURANCE_ACTIONABLE_STATUSES.slice().sort().join(",") ===
    ["expiring_soon", "lapsed"].join(","),
);
ok("urgency: lapsed before expiring_soon", INSURANCE_URGENCY.lapsed < INSURANCE_URGENCY.expiring_soon);

// --- date helper ------------------------------------------------------------
ok("daysBetween counts forward", daysBetween("2026-06-29", "2026-07-09") === 10);
ok("daysBetween is negative in the past", daysBetween("2026-06-29", "2026-06-19") === -10);
ok("daysBetween null on junk", daysBetween("2026-13-40", "2026-07-09") === null);

// --- expiry anchor ----------------------------------------------------------
ok(
  "anchor uses expiry_date when present",
  insuranceExpiryAnchor({ expiry_date: "2026-12-01" }) === "2026-12-01",
);
ok("anchor null when no expiry", insuranceExpiryAnchor({ provider: "Square One" }) === null);
ok("anchor null on malformed expiry", insuranceExpiryAnchor({ expiry_date: "soon" }) === null);

// --- status bands (default 30-day window) -----------------------------------
ok("no expiry => unknown", insuranceStatus(null, TODAY) === "unknown");
ok("far future => ok", insuranceStatus("2027-01-01", TODAY) === "ok");
ok("60 days out => ok (outside 30-day window)", insuranceStatus("2026-08-28", TODAY) === "ok");
ok("20 days out => expiring_soon", insuranceStatus("2026-07-19", TODAY) === "expiring_soon");
ok("exactly the lead edge (30d) => expiring_soon", insuranceStatus("2026-07-29", TODAY) === "expiring_soon");
ok("today is expiry => lapsed", insuranceStatus("2026-06-29", TODAY) === "lapsed");
ok("past expiry => lapsed", insuranceStatus("2026-05-01", TODAY) === "lapsed");

// statusFor straight from a policy input
ok(
  "statusFor lapsed policy",
  insuranceStatusFor({ provider: "TD", expiry_date: "2026-01-01" }, TODAY) === "lapsed",
);
ok(
  "statusFor ok policy",
  insuranceStatusFor({ provider: "TD", expiry_date: "2028-01-01" }, TODAY) === "ok",
);

// custom lead window is honoured
ok("custom 60-day window flips 45d-out to expiring_soon", insuranceStatus("2026-08-13", TODAY, 60) === "expiring_soon");

// --- actionable predicate ---------------------------------------------------
ok("isActionable expiring_soon", isActionableInsuranceStatus("expiring_soon"));
ok("isActionable lapsed", isActionableInsuranceStatus("lapsed"));
ok("not actionable ok", !isActionableInsuranceStatus("ok"));
ok("not actionable unknown", !isActionableInsuranceStatus("unknown"));

// --- coverage formatting ----------------------------------------------------
ok("coverage 1,000,000", formatCoverageCents(100000000) === "$1,000,000");
ok("coverage null on null", formatCoverageCents(null) === null);
ok("coverage null on negative", formatCoverageCents(-5) === null);

// --- nudge decision + PHASE-AWARE idempotency -------------------------------
// Helper: derive status + expiry from a policy input as of `today`, then decide.
// Idempotency is now phase-aware: pre-expiry and lapsed carry SEPARATE stamps
// (expiring_nudged_for / lapse_nudged_for) so the expiring-soon email can never
// suppress the later lapsed email for the same expiry (S384 / Codex finding).
function decide(
  d: InsuranceInput,
  expiringNudgedFor: string | null,
  lapseNudgedFor: string | null,
  today: string = TODAY,
  force = false,
) {
  const expiryDate = insuranceExpiryAnchor(d);
  const status = insuranceStatusFor(d, today);
  return decideInsuranceNudge({ expiryDate, status, expiringNudgedFor, lapseNudgedFor, force });
}

// A lapsed policy — actionable, never nudged -> nudge + stamp the LAPSE column.
const lapsed: InsuranceInput = { provider: "Square One", expiry_date: "2026-05-01" };
const d1 = decide(lapsed, null, null);
ok("lapsed policy nudges", d1.nudge && d1.reason === "due");
ok("lapsed stamps the lapse column", d1.stampColumn === "lapse_nudged_for" && d1.stampFor === "2026-05-01");

// Already lapse-nudged for this term -> no re-nudge (the pinger is idempotent).
const d2 = decide(lapsed, null, "2026-05-01");
ok("already-lapse-nudged is suppressed", !d2.nudge && d2.reason === "already_nudged");

// CRITICAL (the S384 bug): an expiring-soon stamp must NOT suppress the lapsed
// email for the same expiry — the two phases are tracked independently.
const d2b = decide(lapsed, "2026-05-01", null);
ok("expiring stamp does not suppress lapsed", d2b.nudge && d2b.stampColumn === "lapse_nudged_for");

// force bypasses the gate (still stamps).
const d3 = decide(lapsed, null, "2026-05-01", TODAY, true);
ok("force re-nudges", d3.nudge && d3.stampFor === "2026-05-01");

// A renewal (new expiry) re-arms: old stamps no longer match; new term ok -> not actionable yet.
const renewed: InsuranceInput = { provider: "Square One", expiry_date: "2027-05-01" };
const d4 = decide(renewed, "2026-05-01", "2026-05-01");
ok("renewed policy not actionable yet", !d4.nudge && d4.reason.startsWith("not_actionable"));

// An expiring_soon policy with a stale expiring stamp from a PRIOR term re-arms.
const expiringSoon: InsuranceInput = { provider: "TD", expiry_date: "2026-07-19" };
const d5 = decide(expiringSoon, "2025-07-19", null); // expiring stamp from last year's term
ok(
  "expiring_soon policy with stale stamp nudges",
  d5.nudge && d5.stampColumn === "expiring_nudged_for" && d5.stampFor === "2026-07-19",
);

// An ok policy never nudges.
const okItem: InsuranceInput = { provider: "TD", expiry_date: "2028-01-01" };
const d6 = decide(okItem, null, null);
ok("ok policy does not nudge", !d6.nudge);

// No expiry -> no nudge, no stamp.
const d7 = decide({ provider: "TD" }, null, null);
ok("no expiry does not nudge", !d7.nudge && d7.stampFor === null && d7.reason === "no_expiry_date");

// --- Codex contract: full pre-expiry -> lapsed lifecycle for ONE expiry ------
// Walk a single policy (expires 2026-07-09) through both phases, persisting the
// stamps the way the cron does, and assert the promised 5-step sequence.
const policy: InsuranceInput = { provider: "Square One", expiry_date: "2026-07-09" };
let expStamp: string | null = null;
let lapStamp: string | null = null;

// 1) 20 days before expiry -> nudges (expiring_soon) and stamps pre-expiry.
const step1 = decide(policy, expStamp, lapStamp, "2026-06-19");
ok(
  "step1: 20d before -> expiring nudge + stamp",
  step1.nudge && step1.stampColumn === "expiring_nudged_for" && step1.stampFor === "2026-07-09",
);
if (step1.nudge && step1.stampColumn === "expiring_nudged_for") expStamp = step1.stampFor;

// 2) same date/run -> no duplicate.
const step2 = decide(policy, expStamp, lapStamp, "2026-06-19");
ok("step2: same run -> no duplicate", !step2.nudge && step2.reason === "already_nudged");

// 3) on/after expiry -> nudges again as lapsed.
const step3 = decide(policy, expStamp, lapStamp, "2026-07-09");
ok(
  "step3: at expiry -> lapsed nudge + stamp",
  step3.nudge && step3.stampColumn === "lapse_nudged_for" && step3.stampFor === "2026-07-09",
);
if (step3.nudge && step3.stampColumn === "lapse_nudged_for") lapStamp = step3.stampFor;

// 4) second lapsed run -> no duplicate.
const step4 = decide(policy, expStamp, lapStamp, "2026-07-20");
ok("step4: second lapsed -> no duplicate", !step4.nudge && step4.reason === "already_nudged");

// 5) new expiry/renewal -> re-arms (both phases armed for the new term).
const renewedPolicy: InsuranceInput = { provider: "Square One", expiry_date: "2027-07-09" };
const step5 = decide(renewedPolicy, expStamp, lapStamp, "2027-06-19");
ok(
  "step5: renewal re-arms (expiring)",
  step5.nudge && step5.stampColumn === "expiring_nudged_for" && step5.stampFor === "2027-07-09",
);
const step5lapsed = decide(renewedPolicy, "2027-07-09", lapStamp, "2027-07-09");
ok(
  "step5: renewal re-arms the lapsed phase too",
  step5lapsed.nudge && step5lapsed.stampColumn === "lapse_nudged_for",
);

// --- summary ----------------------------------------------------------------
console.log(`\ntenancy-insurance: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
