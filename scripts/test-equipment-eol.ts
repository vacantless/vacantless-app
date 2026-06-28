// Unit tests for the major-equipment end-of-life math + reminder sweep selection
// (S361). Run: npx tsx scripts/test-equipment-eol.ts
import {
  TYPE_SERVICE_LIFE_YEARS,
  TYPE_LEAD_DAYS,
  EQUIPMENT_LEAD_DAYS_FALLBACK,
  EQUIPMENT_ACTIONABLE_STATUSES,
  effectiveServiceLifeYears,
  equipmentLeadDays,
  equipmentInstallAnchor,
  computeEolDate,
  equipmentStatus,
  equipmentStatusFor,
  isActionableEquipmentStatus,
  daysBetween,
  equipmentTypeLabel,
  type EquipmentInput,
} from "../lib/equipment-eol";
import { decideEquipmentNudge } from "../lib/equipment-eol-sweep";

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
ok("water_heater default 10", TYPE_SERVICE_LIFE_YEARS.water_heater === 10);
ok("furnace default 15", TYPE_SERVICE_LIFE_YEARS.furnace === 15);
ok(
  "effective uses type default when no override",
  effectiveServiceLifeYears({ equipment_type: "furnace" }) === 15,
);
ok(
  "effective uses override when set (tankless ~20)",
  effectiveServiceLifeYears({ equipment_type: "water_heater", service_life_years: 20 }) === 20,
);
ok(
  "effective ignores junk override (<=0)",
  effectiveServiceLifeYears({ equipment_type: "furnace", service_life_years: 0 }) === 15,
);

// --- per-type lead window ---------------------------------------------------
ok("water_heater lead 120", TYPE_LEAD_DAYS.water_heater === 120);
ok("furnace lead 180", TYPE_LEAD_DAYS.furnace === 180);
ok("equipmentLeadDays water_heater = 120", equipmentLeadDays("water_heater") === 120);
ok("equipmentLeadDays furnace = 180", equipmentLeadDays("furnace") === 180);
ok("lead fallback defined", EQUIPMENT_LEAD_DAYS_FALLBACK === 120);

// --- install anchor: date preferred, year fallback, unknown -----------------
ok(
  "anchor uses install_date when present",
  equipmentInstallAnchor({ equipment_type: "furnace", install_date: "2012-06-15" }) === "2012-06-15",
);
ok(
  "anchor falls back to Jan 1 of install_year",
  equipmentInstallAnchor({ equipment_type: "furnace", install_year: 2011 }) === "2011-01-01",
);
ok(
  "anchor null when neither known",
  equipmentInstallAnchor({ equipment_type: "water_heater" }) === null,
);
ok(
  "install_date wins over install_year",
  equipmentInstallAnchor({
    equipment_type: "water_heater",
    install_date: "2018-03-02",
    install_year: 2015,
  }) === "2018-03-02",
);

// --- EOL computation --------------------------------------------------------
ok(
  "water_heater installed 2016-06-15 -> EOL 2026-06-15 (10yr)",
  computeEolDate({ equipment_type: "water_heater", install_date: "2016-06-15" }) === "2026-06-15",
);
ok(
  "furnace installed 2011 -> EOL 2026-01-01 (15yr from year start)",
  computeEolDate({ equipment_type: "furnace", install_year: 2011 }) === "2026-01-01",
);
ok(
  "override lengthens EOL (tankless 20yr)",
  computeEolDate({
    equipment_type: "water_heater",
    install_date: "2020-01-01",
    service_life_years: 20,
  }) === "2040-01-01",
);
ok(
  "EOL null when install unknown",
  computeEolDate({ equipment_type: "furnace" }) === null,
);
ok(
  "leap-day install clamps to Feb 28 on non-leap EOL year",
  // 2011-02-29 is invalid; use 2012-02-29 + 15yr -> 2027 (non-leap) -> 2027-02-28
  computeEolDate({ equipment_type: "furnace", install_date: "2012-02-29" }) === "2027-02-28",
);

// --- daysBetween ------------------------------------------------------------
ok("daysBetween same day = 0", daysBetween("2026-06-27", "2026-06-27") === 0);
ok("daysBetween +1", daysBetween("2026-06-27", "2026-06-28") === 1);
ok("daysBetween negative when b before a", daysBetween("2026-06-27", "2026-06-20") === -7);
ok("daysBetween null on junk", daysBetween("nope", "2026-06-27") === null);

// --- status bands (today = 2026-06-27), explicit leadDays -------------------
const TODAY = "2026-06-27";
ok("status unknown when no EOL", equipmentStatus(null, TODAY, 120) === "unknown");
ok("status overdue when EOL in the past", equipmentStatus("2025-06-15", TODAY, 120) === "overdue");
ok("status overdue on the EOL day itself", equipmentStatus(TODAY, TODAY, 120) === "overdue");
ok(
  "status due_soon inside the lead window",
  equipmentStatus("2026-08-01", TODAY, 120) === "due_soon", // ~35 days out
);
ok(
  "status due_soon at the 120d lead-window edge",
  equipmentStatus("2026-10-25", TODAY, 120) === "due_soon", // exactly 120 days out
);
ok(
  "status ok just beyond the 120d lead window",
  equipmentStatus("2026-10-26", TODAY, 120) === "ok", // 121 days out
);
ok("status ok far off", equipmentStatus("2035-01-01", TODAY, 120) === "ok");

// --- per-type lead window: the SAME EOL date bands differently by type ------
// EOL 2026-11-24 is 150 days from TODAY: beyond a water heater's 120d window (ok)
// but inside a furnace's 180d window (due_soon). This is the one place equipment
// diverges from the flat-window detector primitive.
ok(
  "150d-out water heater is OK (120d window)",
  equipmentStatusFor({ equipment_type: "water_heater", install_date: "2016-11-24" }, TODAY) === "ok",
);
ok(
  "150d-out furnace is DUE_SOON (180d window)",
  equipmentStatusFor({ equipment_type: "furnace", install_date: "2011-11-24" }, TODAY) === "due_soon",
);

ok(
  "actionable band = due_soon + overdue",
  EQUIPMENT_ACTIONABLE_STATUSES.slice().sort().join(",") === ["due_soon", "overdue"].join(","),
);
ok("isActionable due_soon", isActionableEquipmentStatus("due_soon"));
ok("isActionable overdue", isActionableEquipmentStatus("overdue"));
ok("not actionable ok", !isActionableEquipmentStatus("ok"));
ok("not actionable unknown", !isActionableEquipmentStatus("unknown"));

// --- labels -----------------------------------------------------------------
ok("label water_heater", equipmentTypeLabel("water_heater") === "Water heater");
ok("label furnace", equipmentTypeLabel("furnace") === "Furnace");

// --- nudge decision + idempotency -------------------------------------------
// Helper: derive status + EOL from an equipment input as of TODAY (using its
// per-type lead window), then decide.
function decide(d: EquipmentInput, lastNudgedFor: string | null, force = false) {
  const eolDate = computeEolDate(d);
  const status = equipmentStatusFor(d, TODAY);
  return decideEquipmentNudge({ eolDate, status, lastNudgedFor, force });
}

// An overdue water heater (installed 2016) — actionable, never nudged -> nudge + stamp EOL.
const overdue: EquipmentInput = { equipment_type: "water_heater", install_date: "2016-06-15" };
const d1 = decide(overdue, null);
ok("overdue water heater nudges", d1.nudge && d1.reason === "due");
ok("overdue stampFor is the EOL date", d1.stampFor === "2026-06-15");

// Already nudged for this EOL -> no re-nudge (the 15-min pinger is idempotent).
const d2 = decide(overdue, "2026-06-15");
ok("already-nudged is suppressed", !d2.nudge && d2.reason === "already_nudged");

// force bypasses the gate (still stamps).
const d3 = decide(overdue, "2026-06-15", true);
ok("force re-nudges", d3.nudge && d3.stampFor === "2026-06-15");

// A replacement (new install date -> new EOL) re-arms: old stamp no longer matches.
const replaced: EquipmentInput = { equipment_type: "water_heater", install_date: "2026-01-10" };
// New EOL = 2036-01-10, status ok -> not actionable yet, so no nudge.
const d4 = decide(replaced, "2026-06-15");
ok("replaced water heater not actionable yet", !d4.nudge && d4.reason.startsWith("not_actionable"));

// A due_soon furnace with a stale stamp from a PRIOR lifecycle re-arms.
// Furnace installed 2011-11-24 -> EOL 2026-11-24, 150d out -> due_soon (180 window).
const dueSoon: EquipmentInput = { equipment_type: "furnace", install_date: "2011-11-24" };
const d5 = decide(dueSoon, "2011-11-24"); // stamp from a different (old) date
ok("due_soon furnace with stale stamp nudges", d5.nudge && d5.stampFor === "2026-11-24");

// An ok furnace never nudges.
const okItem: EquipmentInput = { equipment_type: "furnace", install_date: "2024-01-01" };
const d6 = decide(okItem, null);
ok("ok furnace does not nudge", !d6.nudge);

// Unknown install -> no nudge, no stamp.
const d7 = decide({ equipment_type: "furnace" }, null);
ok("unknown install does not nudge", !d7.nudge && d7.stampFor === null && d7.reason === "no_eol_date");

// --- summary ----------------------------------------------------------------
console.log(`\nequipment-eol: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
