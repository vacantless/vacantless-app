// Unit tests for the appliance-care math (warranty one-shot + recurring
// consumable) + reminder sweep selection (S362). Run:
//   npx tsx scripts/test-appliance-care.ts
import {
  APPLIANCE_TYPES,
  WARRANTY_LEAD_DAYS,
  CONSUMABLE_LEAD_DAYS,
  APPLIANCE_ACTIONABLE_STATUSES,
  applianceTypeLabel,
  isActionableApplianceStatus,
  addMonths,
  daysBetween,
  appliancePurchaseAnchor,
  warrantyExpiryDate,
  hasConsumable,
  consumableAnchor,
  consumableNextDue,
  dateStatus,
  warrantyStatusFor,
  consumableStatusFor,
  type ApplianceInput,
  type ConsumableInput,
} from "../lib/appliance-care";
import { decideApplianceNudge } from "../lib/appliance-care-sweep";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TODAY = "2026-06-27";

// --- types + labels ---------------------------------------------------------
ok("7 appliance types", APPLIANCE_TYPES.length === 7);
ok("label fridge", applianceTypeLabel("fridge") === "Refrigerator");
ok("label stove", applianceTypeLabel("stove") === "Stove / range");
ok("label other", applianceTypeLabel("other") === "Appliance");
ok("warranty lead 45", WARRANTY_LEAD_DAYS === 45);
ok("consumable lead 21", CONSUMABLE_LEAD_DAYS === 21);

// --- addMonths (clamps day to end of target month) --------------------------
ok("addMonths simple +6", addMonths("2025-01-15", 6) === "2025-07-15");
ok("addMonths crosses year", addMonths("2025-11-10", 3) === "2026-02-10");
ok("addMonths +12 = +1yr", addMonths("2020-02-29", 12) === "2021-02-28"); // 2021 non-leap clamp
ok("addMonths Jan31 + 1 -> Feb28", addMonths("2025-01-31", 1) === "2025-02-28");
ok("addMonths Jan31 + 1 leap -> Feb29", addMonths("2024-01-31", 1) === "2024-02-29");
ok("addMonths +0 identity", addMonths("2026-06-27", 0) === "2026-06-27");
ok("addMonths large (120mo)", addMonths("2020-06-15", 120) === "2030-06-15");

// --- daysBetween ------------------------------------------------------------
ok("daysBetween same day = 0", daysBetween("2026-06-27", "2026-06-27") === 0);
ok("daysBetween +1", daysBetween("2026-06-27", "2026-06-28") === 1);
ok("daysBetween negative", daysBetween("2026-06-27", "2026-06-20") === -7);
ok("daysBetween null on junk", daysBetween("nope", "2026-06-27") === null);

// --- purchase anchor: date preferred, year fallback, unknown ----------------
ok(
  "anchor uses purchase_date",
  appliancePurchaseAnchor({ purchase_date: "2022-04-10" }) === "2022-04-10",
);
ok(
  "anchor falls back to Jan 1 of install_year",
  appliancePurchaseAnchor({ install_year: 2021 }) === "2021-01-01",
);
ok("anchor null when neither known", appliancePurchaseAnchor({}) === null);
ok(
  "purchase_date wins over install_year",
  appliancePurchaseAnchor({ purchase_date: "2023-09-01", install_year: 2019 }) === "2023-09-01",
);

// --- WARRANTY one-shot ------------------------------------------------------
ok(
  "warranty expiry = purchase + months (24mo)",
  warrantyExpiryDate({ purchase_date: "2025-06-27", warranty_months: 24 }) === "2027-06-27",
);
ok(
  "warranty expiry from install_year start",
  warrantyExpiryDate({ install_year: 2024, warranty_months: 12 }) === "2025-01-01",
);
ok(
  "warranty null when no months",
  warrantyExpiryDate({ purchase_date: "2025-06-27" }) === null,
);
ok(
  "warranty null when no anchor",
  warrantyExpiryDate({ warranty_months: 24 }) === null,
);
ok(
  "warranty ignores junk months (<=0)",
  warrantyExpiryDate({ purchase_date: "2025-06-27", warranty_months: 0 }) === null,
);

// warranty status bands (lead 45d). expiry 2026-08-01 is ~35d out -> due_soon.
ok(
  "warranty due_soon inside 45d lead",
  warrantyStatusFor({ purchase_date: "2024-08-01", warranty_months: 24 }, TODAY) === "due_soon",
);
ok(
  "warranty ok well before expiry",
  warrantyStatusFor({ purchase_date: "2025-06-27", warranty_months: 24 }, TODAY) === "ok",
);
ok(
  "warranty overdue (lapsed)",
  warrantyStatusFor({ purchase_date: "2023-01-01", warranty_months: 12 }, TODAY) === "overdue",
);
ok(
  "warranty unknown when not configured",
  warrantyStatusFor({ purchase_date: "2025-06-27" }, TODAY) === "unknown",
);

// --- CONSUMABLE recurring (S389: per child row, with a fallback anchor) ------
// The appliance's purchase anchor used as the fallback when a consumable has no
// last-replaced date of its own.
const PURCHASE_ANCHOR_2024 = appliancePurchaseAnchor({ purchase_date: "2024-05-01" }); // "2024-05-01"

ok("hasConsumable true with interval", hasConsumable({ interval_months: 6 }));
ok("hasConsumable false without interval", !hasConsumable({}));
ok("hasConsumable false with zero interval", !hasConsumable({ interval_months: 0 }));
ok("hasConsumable false with negative interval", !hasConsumable({ interval_months: -3 }));

// consumable anchor: explicit last-replaced wins, else the appliance fallback.
ok(
  "consumableAnchor uses explicit last-replaced",
  consumableAnchor({ interval_months: 6, anchor_date: "2026-03-01" }, "2020-01-01") === "2026-03-01",
);
ok(
  "consumableAnchor falls back to the appliance purchase anchor",
  consumableAnchor({ interval_months: 6 }, PURCHASE_ANCHOR_2024) === "2024-05-01",
);
ok(
  "consumableAnchor null when neither known",
  consumableAnchor({ interval_months: 6 }, null) === null,
);

// next due = anchor + one interval.
ok(
  "consumable due = last-replaced + interval",
  consumableNextDue({ interval_months: 6, anchor_date: "2026-06-01" }, null) === "2026-12-01",
);
ok(
  "consumable due uses the fallback anchor when no last-replaced",
  // fallback 2024-05-01 + 12mo -> 2025-05-01
  consumableNextDue({ interval_months: 12 }, "2024-05-01") === "2025-05-01",
);
ok(
  "consumable due null when no interval",
  consumableNextDue({ anchor_date: "2026-06-01" }, "2024-05-01") === null,
);
ok(
  "consumable due null when no interval and no anchor",
  consumableNextDue({}, null) === null,
);

// Two consumables on the SAME appliance compute independently (the whole point
// of S389): a 6-month filter and a 12-month filter off the same purchase anchor.
ok(
  "two consumables, different intervals, off the same purchase anchor",
  consumableNextDue({ interval_months: 6 }, "2026-01-01") === "2026-07-01" &&
    consumableNextDue({ interval_months: 12 }, "2026-01-01") === "2027-01-01",
);

// consumable status bands (lead 21d).
ok(
  "consumable due_soon inside 21d lead",
  // anchor 2026-01-10 + 6mo -> 2026-07-10 (~13 days out) -> due_soon.
  consumableStatusFor({ interval_months: 6, anchor_date: "2026-01-10" }, null, TODAY) === "due_soon",
);
ok(
  "consumable overdue when last-replaced long ago",
  consumableStatusFor({ interval_months: 6, anchor_date: "2025-06-01" }, null, TODAY) === "overdue",
);
ok(
  "consumable ok when recently replaced",
  consumableStatusFor({ interval_months: 12, anchor_date: "2026-05-01" }, null, TODAY) === "ok",
);
ok(
  "consumable status uses the fallback anchor (overdue off an old purchase)",
  // no anchor_date; fallback 2024-05-01 + 6mo -> 2024-11-01 (long past) -> overdue.
  consumableStatusFor({ interval_months: 6 }, "2024-05-01", TODAY) === "overdue",
);

// --- shared banding edges (explicit leadDays) -------------------------------
ok("dateStatus unknown when null", dateStatus(null, TODAY, 45) === "unknown");
ok("dateStatus overdue on the day", dateStatus(TODAY, TODAY, 45) === "overdue");
ok("dateStatus due_soon at exact lead edge", dateStatus("2026-08-11", TODAY, 45) === "due_soon"); // 45d
ok("dateStatus ok one past lead edge", dateStatus("2026-08-12", TODAY, 45) === "ok"); // 46d

ok(
  "actionable band = due_soon + overdue",
  APPLIANCE_ACTIONABLE_STATUSES.slice().sort().join(",") === ["due_soon", "overdue"].join(","),
);
ok("isActionable due_soon", isActionableApplianceStatus("due_soon"));
ok("isActionable overdue", isActionableApplianceStatus("overdue"));
ok("not actionable ok", !isActionableApplianceStatus("ok"));
ok("not actionable unknown", !isActionableApplianceStatus("unknown"));

// --- WARRANTY nudge decision + idempotency ----------------------------------
function decideWarranty(d: ApplianceInput, lastNudgedFor: string | null, force = false) {
  return decideApplianceNudge({
    targetDate: warrantyExpiryDate(d),
    status: warrantyStatusFor(d, TODAY),
    lastNudgedFor,
    force,
  });
}
const warrantyDue: ApplianceInput = { purchase_date: "2024-08-01", warranty_months: 24 }; // expiry 2026-08-01
const w1 = decideWarranty(warrantyDue, null);
ok("warranty due nudges", w1.nudge && w1.reason === "due");
ok("warranty stampFor is the expiry date", w1.stampFor === "2026-08-01");
const w2 = decideWarranty(warrantyDue, "2026-08-01");
ok("warranty already-nudged suppressed", !w2.nudge && w2.reason === "already_nudged");
const w3 = decideWarranty(warrantyDue, "2026-08-01", true);
ok("warranty force re-nudges", w3.nudge);
const wOk: ApplianceInput = { purchase_date: "2026-01-01", warranty_months: 24 };
ok("warranty ok does not nudge", !decideWarranty(wOk, null).nudge);
ok(
  "warranty unconfigured does not nudge",
  !decideWarranty({ purchase_date: "2026-01-01" }, null).nudge &&
    decideWarranty({ purchase_date: "2026-01-01" }, null).reason === "no_target_date",
);

// --- CONSUMABLE nudge decision + RE-ARM (the recurrence) --------------------
function decideConsumable(
  c: ConsumableInput,
  fallbackAnchor: string | null,
  lastNudgedFor: string | null,
  force = false,
) {
  return decideApplianceNudge({
    targetDate: consumableNextDue(c, fallbackAnchor),
    status: consumableStatusFor(c, fallbackAnchor, TODAY),
    lastNudgedFor,
    force,
  });
}
// Overdue filter (last replaced 2025-06-01, 6mo interval -> due 2025-12-01).
const filterOverdue: ConsumableInput = { interval_months: 6, anchor_date: "2025-06-01" };
const c1 = decideConsumable(filterOverdue, null, null);
ok("overdue filter nudges", c1.nudge && c1.reason === "due");
ok("filter stampFor is the next-due date", c1.stampFor === "2025-12-01");
// Same cycle, already nudged -> suppressed (no nagging every tick).
const c2 = decideConsumable(filterOverdue, null, "2025-12-01");
ok("filter already-nudged suppressed", !c2.nudge && c2.reason === "already_nudged");
// MARK REPLACED: anchor rolls to today -> next due 2026-12-27 -> status ok -> not
// actionable yet, and the old stamp no longer matches (the cycle has advanced).
const filterReplaced: ConsumableInput = { interval_months: 6, anchor_date: TODAY };
const c3 = decideConsumable(filterReplaced, null, "2025-12-01");
ok("after mark-replaced, next cycle not due yet", !c3.nudge && c3.reason.startsWith("not_actionable"));
ok(
  "after mark-replaced, due date advanced one cycle",
  consumableNextDue(filterReplaced, null) === "2026-12-27",
);
// A NEW cycle later (anchor 2026-01-10 -> due 2026-07-10, due_soon) with a STALE
// stamp from the PRIOR cycle re-arms (stamp != new due date).
const filterNextCycle: ConsumableInput = { interval_months: 6, anchor_date: "2026-01-10" };
const c4 = decideConsumable(filterNextCycle, null, "2025-12-01");
ok("new cycle with stale stamp re-arms", c4.nudge && c4.stampFor === "2026-07-10");
// Unconfigured consumable never nudges.
const c5 = decideConsumable({}, null, null);
ok("unconfigured consumable does not nudge", !c5.nudge && c5.reason === "no_target_date");
// Two consumables on one appliance decide independently: one due, one ok.
const cA = decideConsumable({ interval_months: 6, anchor_date: "2025-06-01" }, null, null); // due 2025-12-01 overdue
const cB = decideConsumable({ interval_months: 12, anchor_date: "2026-05-01" }, null, null); // due 2027-05-01 ok
ok("multi-consumable: overdue one nudges", cA.nudge && cA.stampFor === "2025-12-01");
ok("multi-consumable: ok one stays silent", !cB.nudge && cB.reason.startsWith("not_actionable"));

// --- summary ----------------------------------------------------------------
console.log(`\nappliance-care: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
