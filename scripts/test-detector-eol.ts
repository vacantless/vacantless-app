// Unit tests for the detector end-of-life math + reminder sweep selection (S359).
// Run: npx tsx scripts/test-detector-eol.ts
import {
  TYPE_SERVICE_LIFE_YEARS,
  DETECTOR_LEAD_DAYS,
  DETECTOR_ACTIONABLE_STATUSES,
  effectiveServiceLifeYears,
  detectorInstallAnchor,
  computeEolDate,
  detectorStatus,
  isActionableDetectorStatus,
  daysBetween,
  detectorTypeLabel,
  type DetectorInput,
} from "../lib/detector-eol";
import { decideDetectorNudge } from "../lib/detector-eol-sweep";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- service life: per-type defaults + override ------------------------------
ok("smoke default 10", TYPE_SERVICE_LIFE_YEARS.smoke === 10);
ok("co default 7", TYPE_SERVICE_LIFE_YEARS.co === 7);
ok("combo default 10", TYPE_SERVICE_LIFE_YEARS.combo === 10);
ok(
  "effective uses type default when no override",
  effectiveServiceLifeYears({ detector_type: "co" }) === 7,
);
ok(
  "effective uses override when set",
  effectiveServiceLifeYears({ detector_type: "co", service_life_years: 5 }) === 5,
);
ok(
  "effective ignores junk override (<=0)",
  effectiveServiceLifeYears({ detector_type: "smoke", service_life_years: 0 }) === 10,
);

// --- install anchor: date preferred, year fallback, unknown -----------------
ok(
  "anchor uses install_date when present",
  detectorInstallAnchor({ detector_type: "combo", install_date: "2015-06-15" }) === "2015-06-15",
);
ok(
  "anchor falls back to Jan 1 of install_year",
  detectorInstallAnchor({ detector_type: "combo", install_year: 2015 }) === "2015-01-01",
);
ok(
  "anchor null when neither known",
  detectorInstallAnchor({ detector_type: "combo" }) === null,
);
ok(
  "install_date wins over install_year",
  detectorInstallAnchor({ detector_type: "combo", install_date: "2018-03-02", install_year: 2015 }) ===
    "2018-03-02",
);

// --- EOL computation --------------------------------------------------------
ok(
  "combo installed 2015-06-15 -> EOL 2025-06-15",
  computeEolDate({ detector_type: "combo", install_date: "2015-06-15" }) === "2025-06-15",
);
ok(
  "co installed 2015 -> EOL 2022-01-01 (7yr from year start)",
  computeEolDate({ detector_type: "co", install_year: 2015 }) === "2022-01-01",
);
ok(
  "override shortens EOL",
  computeEolDate({ detector_type: "combo", install_date: "2020-01-01", service_life_years: 5 }) ===
    "2025-01-01",
);
ok(
  "EOL null when install unknown",
  computeEolDate({ detector_type: "smoke" }) === null,
);
ok(
  "leap-day install clamps to Feb 28 on non-leap EOL year",
  // 2016-02-29 + 10yr -> 2026 (non-leap) -> 2026-02-28
  computeEolDate({ detector_type: "smoke", install_date: "2016-02-29" }) === "2026-02-28",
);

// --- daysBetween ------------------------------------------------------------
ok("daysBetween same day = 0", daysBetween("2026-06-27", "2026-06-27") === 0);
ok("daysBetween +1", daysBetween("2026-06-27", "2026-06-28") === 1);
ok("daysBetween negative when b before a", daysBetween("2026-06-27", "2026-06-20") === -7);
ok("daysBetween null on junk", daysBetween("nope", "2026-06-27") === null);

// --- status bands (today = 2026-06-27, lead = 90) ---------------------------
const TODAY = "2026-06-27";
ok("status unknown when no EOL", detectorStatus(null, TODAY) === "unknown");
ok("status overdue when EOL in the past", detectorStatus("2025-06-15", TODAY) === "overdue");
ok("status overdue on the EOL day itself", detectorStatus(TODAY, TODAY) === "overdue");
ok(
  "status due_soon inside the lead window",
  detectorStatus("2026-08-01", TODAY) === "due_soon", // ~35 days out
);
ok(
  "status due_soon at the lead-window edge",
  detectorStatus("2026-09-25", TODAY) === "due_soon", // 90 days out
);
ok(
  "status ok just beyond the lead window",
  detectorStatus("2026-09-26", TODAY) === "ok", // 91 days out
);
ok("status ok far off", detectorStatus("2030-01-01", TODAY) === "ok");
ok(
  "actionable band = due_soon + overdue",
  DETECTOR_ACTIONABLE_STATUSES.slice().sort().join(",") === ["due_soon", "overdue"].join(","),
);
ok("isActionable due_soon", isActionableDetectorStatus("due_soon"));
ok("isActionable overdue", isActionableDetectorStatus("overdue"));
ok("not actionable ok", !isActionableDetectorStatus("ok"));
ok("not actionable unknown", !isActionableDetectorStatus("unknown"));
ok("lead days is 90", DETECTOR_LEAD_DAYS === 90);

// --- labels -----------------------------------------------------------------
ok("label smoke", detectorTypeLabel("smoke") === "Smoke");
ok("label combo mentions combo", /combo/i.test(detectorTypeLabel("combo")));

// --- nudge decision + idempotency -------------------------------------------
// Helper: derive status + EOL from a detector input as of TODAY, then decide.
function decide(d: DetectorInput, lastNudgedFor: string | null, force = false) {
  const eolDate = computeEolDate(d);
  const status = detectorStatus(eolDate, TODAY);
  return decideDetectorNudge({ eolDate, status, lastNudgedFor, force });
}

// An overdue combo (installed 2015) — actionable, never nudged -> nudge + stamp EOL.
const overdue: DetectorInput = { detector_type: "combo", install_date: "2015-06-15" };
const d1 = decide(overdue, null);
ok("overdue detector nudges", d1.nudge && d1.reason === "due");
ok("overdue stampFor is the EOL date", d1.stampFor === "2025-06-15");

// Already nudged for this EOL -> no re-nudge (the 15-min pinger is idempotent).
const d2 = decide(overdue, "2025-06-15");
ok("already-nudged is suppressed", !d2.nudge && d2.reason === "already_nudged");

// force bypasses the gate (still stamps).
const d3 = decide(overdue, "2025-06-15", true);
ok("force re-nudges", d3.nudge && d3.stampFor === "2025-06-15");

// A replacement (new install date -> new EOL) re-arms: old stamp no longer matches.
const replaced: DetectorInput = { detector_type: "combo", install_date: "2026-01-10" };
// New EOL = 2036-01-10, status ok -> not actionable yet, so no nudge.
const d4 = decide(replaced, "2025-06-15");
ok("replaced detector not actionable yet", !d4.nudge && d4.reason.startsWith("not_actionable"));

// A due_soon detector with a stale stamp from a PRIOR lifecycle re-arms.
const dueSoon: DetectorInput = { detector_type: "smoke", install_date: "2016-08-01" }; // EOL 2026-08-01 ~ due_soon
const d5 = decide(dueSoon, "2016-08-01"); // stamp from a different (old) date
ok("due_soon with stale stamp nudges", d5.nudge && d5.stampFor === "2026-08-01");

// An ok detector never nudges.
const okDet: DetectorInput = { detector_type: "smoke", install_date: "2024-01-01" };
const d6 = decide(okDet, null);
ok("ok detector does not nudge", !d6.nudge);

// Unknown install -> no nudge, no stamp.
const d7 = decide({ detector_type: "co" }, null);
ok("unknown install does not nudge", !d7.nudge && d7.stampFor === null && d7.reason === "no_eol_date");

// --- summary ----------------------------------------------------------------
console.log(`\ndetector-eol: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
