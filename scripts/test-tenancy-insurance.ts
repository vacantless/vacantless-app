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

// --- nudge decision + idempotency -------------------------------------------
// Helper: derive status + expiry from a policy input as of TODAY, then decide.
function decide(d: InsuranceInput, lastNudgedFor: string | null, force = false) {
  const expiryDate = insuranceExpiryAnchor(d);
  const status = insuranceStatusFor(d, TODAY);
  return decideInsuranceNudge({ expiryDate, status, lastNudgedFor, force });
}

// A lapsed policy — actionable, never nudged -> nudge + stamp the expiry date.
const lapsed: InsuranceInput = { provider: "Square One", expiry_date: "2026-05-01" };
const d1 = decide(lapsed, null);
ok("lapsed policy nudges", d1.nudge && d1.reason === "due");
ok("lapsed stampFor is the expiry date", d1.stampFor === "2026-05-01");

// Already nudged for this term -> no re-nudge (the periodic pinger is idempotent).
const d2 = decide(lapsed, "2026-05-01");
ok("already-nudged is suppressed", !d2.nudge && d2.reason === "already_nudged");

// force bypasses the gate (still stamps).
const d3 = decide(lapsed, "2026-05-01", true);
ok("force re-nudges", d3.nudge && d3.stampFor === "2026-05-01");

// A renewal (new expiry) re-arms: old stamp no longer matches; new term ok -> not actionable yet.
const renewed: InsuranceInput = { provider: "Square One", expiry_date: "2027-05-01" };
const d4 = decide(renewed, "2026-05-01");
ok("renewed policy not actionable yet", !d4.nudge && d4.reason.startsWith("not_actionable"));

// An expiring_soon policy with a stale stamp from a PRIOR term re-arms.
const expiringSoon: InsuranceInput = { provider: "TD", expiry_date: "2026-07-19" };
const d5 = decide(expiringSoon, "2025-07-19"); // stamp from last year's term
ok("expiring_soon policy with stale stamp nudges", d5.nudge && d5.stampFor === "2026-07-19");

// An ok policy never nudges.
const okItem: InsuranceInput = { provider: "TD", expiry_date: "2028-01-01" };
const d6 = decide(okItem, null);
ok("ok policy does not nudge", !d6.nudge);

// No expiry -> no nudge, no stamp.
const d7 = decide({ provider: "TD" }, null);
ok("no expiry does not nudge", !d7.nudge && d7.stampFor === null && d7.reason === "no_expiry_date");

// --- summary ----------------------------------------------------------------
console.log(`\ntenancy-insurance: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
