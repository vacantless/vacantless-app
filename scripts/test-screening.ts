// Unit tests for the pure candidate pre-screening evaluator.
// Run: npx tsx scripts/test-screening.ts
import {
  evaluateScreening,
  validateScreeningSettings,
  parseIncomeToCents,
  parseCount,
  isScreenFilter,
  matchesScreenFilter,
  affordabilityHintIncomeCents,
  AFFORDABILITY_INCOME_RATIO,
  incomeRequirementMagnitude,
  SCREENING_REASON,
  resolveScreeningReason,
  cleanScreeningReason,
  MAX_SCREENING_REASON_LEN,
  type OrgScreeningConfig,
  type ScreeningContext,
  type ScreeningAnswers,
} from "../lib/screening";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TODAY = "2026-06-18";

// A fully-on config: income 3x, move-in within 90 days, flag pets.
const fullConfig: OrgScreeningConfig = {
  screening_enabled: true,
  screening_income_multiple: 3,
  screening_max_movein_days: 90,
  screening_flag_pets: true,
  screening_reason_income: null,
  screening_reason_movein: null,
  screening_reason_pets: null,
};

// $2,000/mo rental, not pet-friendly.
const ctx: ScreeningContext = { rent_cents: 200000, pet_friendly: false };

// A strong applicant: $7,000/mo income, soon move-in, no pets.
const goodAnswers: ScreeningAnswers = {
  income_cents: 700000,
  has_pets: false,
  move_in: "2026-07-01",
};

// --- master switch ----------------------------------------------------------
{
  const off = evaluateScreening(
    { ...fullConfig, screening_enabled: false },
    ctx,
    { income_cents: 1000, has_pets: true, move_in: "2030-01-01" },
    TODAY,
  );
  ok("disabled: never qualifies out", off.qualifiedOut === false);
  ok("disabled: no reasons", off.reasons.length === 0);
}

// --- happy path -------------------------------------------------------------
{
  const r = evaluateScreening(fullConfig, ctx, goodAnswers, TODAY);
  ok("good applicant: not flagged", r.qualifiedOut === false);
  ok("good applicant: no reasons", r.reasons.length === 0);
}

// --- income -----------------------------------------------------------------
{
  // $5,000/mo income vs 3x $2,000 = $6,000 required -> below.
  const r = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, income_cents: 500000 },
    TODAY,
  );
  ok("income below: flagged", r.qualifiedOut === true);
  ok("income below: income reason", r.reasons.includes(SCREENING_REASON.income));

  // Exactly 3x is NOT below (>= passes).
  const exact = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, income_cents: 600000 },
    TODAY,
  );
  ok("income exactly 3x: passes", exact.qualifiedOut === false);

  // Missing income -> cannot fail income.
  const missing = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, income_cents: null },
    TODAY,
  );
  ok("income missing: not flagged on income", !missing.reasons.includes(SCREENING_REASON.income));

  // No income multiple configured -> income not screened.
  const noMult = evaluateScreening(
    { ...fullConfig, screening_income_multiple: null },
    ctx,
    { ...goodAnswers, income_cents: 1 },
    TODAY,
  );
  ok("no income multiple: income not screened", !noMult.reasons.includes(SCREENING_REASON.income));

  // No rent on the unit -> can't compute the requirement, don't flag.
  const noRent = evaluateScreening(
    fullConfig,
    { ...ctx, rent_cents: null },
    { ...goodAnswers, income_cents: 1 },
    TODAY,
  );
  ok("no rent: income not screened", !noRent.reasons.includes(SCREENING_REASON.income));
}

// --- move-in window ---------------------------------------------------------
{
  // 91 days out (> 90) -> flagged.
  const late = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, move_in: "2026-09-17" },
    TODAY,
  );
  ok("move-in 91 days: flagged", late.reasons.includes(SCREENING_REASON.moveIn));

  // Exactly 90 days -> passes (not strictly greater).
  const edge = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, move_in: "2026-09-16" },
    TODAY,
  );
  ok("move-in exactly 90 days: passes", !edge.reasons.includes(SCREENING_REASON.moveIn));

  // Missing move-in -> not flagged.
  const missing = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, move_in: null },
    TODAY,
  );
  ok("move-in missing: not flagged", !missing.reasons.includes(SCREENING_REASON.moveIn));

  // No window configured -> not screened even if far out.
  const noWindow = evaluateScreening(
    { ...fullConfig, screening_max_movein_days: null },
    ctx,
    { ...goodAnswers, move_in: "2030-01-01" },
    TODAY,
  );
  ok("no window: move-in not screened", !noWindow.reasons.includes(SCREENING_REASON.moveIn));
}

// --- pets -------------------------------------------------------------------
{
  // Has pets, not pet-friendly -> flagged.
  const petMismatch = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, has_pets: true },
    TODAY,
  );
  ok("pets + not pet-friendly: flagged", petMismatch.reasons.includes(SCREENING_REASON.pets));

  // Has pets, pet-friendly unit -> not flagged.
  const petOk = evaluateScreening(
    fullConfig,
    { ...ctx, pet_friendly: true },
    { ...goodAnswers, has_pets: true },
    TODAY,
  );
  ok("pets + pet-friendly: not flagged", !petOk.reasons.includes(SCREENING_REASON.pets));

  // flag_pets off -> not flagged.
  const noPetFlag = evaluateScreening(
    { ...fullConfig, screening_flag_pets: false },
    ctx,
    { ...goodAnswers, has_pets: true },
    TODAY,
  );
  ok("flag_pets off: not flagged", !noPetFlag.reasons.includes(SCREENING_REASON.pets));

  // has_pets null -> not flagged.
  const petUnknown = evaluateScreening(
    fullConfig,
    ctx,
    { ...goodAnswers, has_pets: null },
    TODAY,
  );
  ok("pets unknown: not flagged", !petUnknown.reasons.includes(SCREENING_REASON.pets));
}

// --- multiple reasons stack -------------------------------------------------
{
  const r = evaluateScreening(
    fullConfig,
    ctx,
    { income_cents: 100000, has_pets: true, move_in: "2030-01-01" },
    TODAY,
  );
  ok("all three fail: qualified out", r.qualifiedOut === true);
  ok("all three fail: 3 reasons", r.reasons.length === 3);
}

// --- validateScreeningSettings ----------------------------------------------
{
  const ok1 = validateScreeningSettings({
    enabled: true,
    income_multiple: "3",
    max_movein_days: "90",
    flag_pets: true,
  });
  ok("settings valid: ok", ok1.ok === true);
  if (ok1.ok) {
    ok("settings valid: income 3", ok1.values.screening_income_multiple === 3);
    ok("settings valid: days 90", ok1.values.screening_max_movein_days === 90);
  }

  // Empty fields -> nulls (don't screen on those).
  const empties = validateScreeningSettings({
    enabled: true,
    income_multiple: "",
    max_movein_days: "",
    flag_pets: false,
  });
  ok("settings empty fields: ok", empties.ok === true);
  if (empties.ok) {
    ok("settings empty: income null", empties.values.screening_income_multiple === null);
    ok("settings empty: days null", empties.values.screening_max_movein_days === null);
  }

  // Decimal income multiple kept to 2dp.
  const dec = validateScreeningSettings({
    enabled: true,
    income_multiple: "2.5",
    max_movein_days: "",
    flag_pets: true,
  });
  ok("settings decimal multiple", dec.ok && dec.values.screening_income_multiple === 2.5);

  // Bad income multiple.
  const badIm = validateScreeningSettings({
    enabled: true,
    income_multiple: "0",
    max_movein_days: "",
    flag_pets: true,
  });
  ok("settings income 0: rejected", badIm.ok === false && badIm.reason === "income_multiple");

  const hugeIm = validateScreeningSettings({
    enabled: true,
    income_multiple: "999",
    max_movein_days: "",
    flag_pets: true,
  });
  ok("settings income 999: rejected", hugeIm.ok === false);

  // Bad days (non-integer).
  const badDays = validateScreeningSettings({
    enabled: true,
    income_multiple: "",
    max_movein_days: "30.5",
    flag_pets: true,
  });
  ok("settings days 30.5: rejected", badDays.ok === false && badDays.reason === "max_movein_days");

  // Reason copy: omitted -> null (keep defaults).
  if (ok1.ok) {
    ok("settings no reason copy: income null", ok1.values.screening_reason_income === null);
    ok("settings no reason copy: movein null", ok1.values.screening_reason_movein === null);
    ok("settings no reason copy: pets null", ok1.values.screening_reason_pets === null);
  }

  // Reason copy: provided -> trimmed/normalized; blank -> null.
  const withCopy = validateScreeningSettings({
    enabled: true,
    income_multiple: "3",
    max_movein_days: "",
    flag_pets: true,
    reason_income: "  Income doesn't meet our 3x guideline  ",
    reason_movein: "   ",
    reason_pets: "No pets on this unit\n(strict)",
  });
  ok("settings reason copy: ok", withCopy.ok === true);
  if (withCopy.ok) {
    ok(
      "settings reason copy: income trimmed",
      withCopy.values.screening_reason_income === "Income doesn't meet our 3x guideline",
    );
    ok("settings reason copy: blank -> null", withCopy.values.screening_reason_movein === null);
    ok(
      "settings reason copy: newlines collapsed",
      withCopy.values.screening_reason_pets === "No pets on this unit (strict)",
    );
  }

  // cleanScreeningReason: clamps to MAX length.
  const long = "x".repeat(MAX_SCREENING_REASON_LEN + 50);
  ok(
    "cleanScreeningReason clamps length",
    (cleanScreeningReason(long) ?? "").length === MAX_SCREENING_REASON_LEN,
  );
  ok("cleanScreeningReason blank -> null", cleanScreeningReason("   ") === null);
  ok("cleanScreeningReason null -> null", cleanScreeningReason(null) === null);
}

// --- resolveScreeningReason + custom copy in evaluateScreening ---------------
{
  ok("resolve: null -> default", resolveScreeningReason(null, SCREENING_REASON.income) === SCREENING_REASON.income);
  ok("resolve: blank -> default", resolveScreeningReason("  ", SCREENING_REASON.pets) === SCREENING_REASON.pets);
  ok("resolve: custom -> trimmed custom", resolveScreeningReason("  Custom  ", SCREENING_REASON.moveIn) === "Custom");

  // A flagged inquiry under an org with custom copy surfaces the custom strings.
  const customConfig: OrgScreeningConfig = {
    ...fullConfig,
    screening_reason_income: "Below our 3x income line",
    screening_reason_movein: "Wants in too late",
    screening_reason_pets: "Pets, but this unit is pet-free",
  };
  const allFail: ScreeningAnswers = {
    income_cents: 100000, // 1x rent on a $2,000 unit -> income fails
    has_pets: true, // not pet-friendly -> pets fails
    move_in: "2026-12-31", // far past the 90-day window -> move-in fails
  };
  const r = evaluateScreening(customConfig, ctx, allFail, TODAY);
  ok("custom copy: 3 reasons", r.reasons.length === 3);
  ok("custom copy: income string", r.reasons.includes("Below our 3x income line"));
  ok("custom copy: movein string", r.reasons.includes("Wants in too late"));
  ok("custom copy: pets string", r.reasons.includes("Pets, but this unit is pet-free"));
  ok("custom copy: no defaults leaked", !r.reasons.includes(SCREENING_REASON.income));

  // A null custom field on one criterion still falls back to its default.
  const mixed: OrgScreeningConfig = {
    ...fullConfig,
    screening_reason_income: "Below our 3x income line",
    screening_reason_movein: null,
    screening_reason_pets: null,
  };
  const r2 = evaluateScreening(mixed, ctx, allFail, TODAY);
  ok("mixed copy: custom income", r2.reasons.includes("Below our 3x income line"));
  ok("mixed copy: default movein", r2.reasons.includes(SCREENING_REASON.moveIn));
  ok("mixed copy: default pets", r2.reasons.includes(SCREENING_REASON.pets));
}

// --- parseIncomeToCents -----------------------------------------------------
{
  ok("income $4,500 -> 450000", parseIncomeToCents("4,500") === 450000);
  ok("income $4500 -> 450000", parseIncomeToCents("$4500") === 450000);
  ok("income 4500.50 -> 450050", parseIncomeToCents("4500.50") === 450050);
  ok("income blank -> null", parseIncomeToCents("") === null);
  ok("income null -> null", parseIncomeToCents(null) === null);
  ok("income garbage -> null", parseIncomeToCents("abc") === null);
  ok("income negative -> null", parseIncomeToCents("-100") === null);
}

// --- parseCount -------------------------------------------------------------
{
  ok("count 2 -> 2", parseCount("2") === 2);
  ok("count blank -> null", parseCount("") === null);
  ok("count 0 -> 0", parseCount("0") === 0);
  ok("count 2.5 -> null", parseCount("2.5") === null);
  ok("count 100 -> null (cap)", parseCount("100") === null);
}

// --- isScreenFilter (inquiries-list URL param guard) -----------------------
{
  ok("isScreenFilter: out", isScreenFilter("out") === true);
  ok("isScreenFilter: ok", isScreenFilter("ok") === true);
  ok("isScreenFilter: junk -> false", isScreenFilter("mismatch") === false);
  ok("isScreenFilter: empty -> false", isScreenFilter("") === false);
  ok("isScreenFilter: null -> false", isScreenFilter(null) === false);
  ok("isScreenFilter: undefined -> false", isScreenFilter(undefined) === false);
}

// --- matchesScreenFilter ----------------------------------------------------
{
  // null filter = show everything
  ok("null filter: flagged matches", matchesScreenFilter(true, null) === true);
  ok("null filter: unflagged matches", matchesScreenFilter(false, null) === true);
  // "out" = only the qualified-out
  ok('"out": flagged matches', matchesScreenFilter(true, "out") === true);
  ok('"out": unflagged excluded', matchesScreenFilter(false, "out") === false);
  // "ok" = only the not-qualified-out (incl never-screened)
  ok('"ok": unflagged matches', matchesScreenFilter(false, "ok") === true);
  ok('"ok": flagged excluded', matchesScreenFilter(true, "ok") === false);
  // partition: every lead lands in exactly one of out/ok
  for (const q of [true, false]) {
    const inOut = matchesScreenFilter(q, "out");
    const inOk = matchesScreenFilter(q, "ok");
    ok(`partition q=${q}: exactly one of out/ok`, inOut !== inOk);
  }
}

// --- affordabilityHintIncomeCents (public income hint, S252) ----------------
{
  // $2,000/mo rent -> 3x = $6,000/mo (already a round $100).
  ok(
    "hint: $2000 rent -> $6000",
    affordabilityHintIncomeCents(200_000) === 600_000,
  );
  // Uses the generic ratio constant, not an org multiple.
  ok("hint ratio is 3", AFFORDABILITY_INCOME_RATIO === 3);
  ok(
    "hint: matches ratio * rent (rounded)",
    affordabilityHintIncomeCents(200_000) ===
      200_000 * AFFORDABILITY_INCOME_RATIO,
  );
  // $1,250/mo rent -> 3x = $3,750/mo, which is exactly a half-hundred and
  // rounds up to $3,800 at $100 granularity.
  ok(
    "hint: $1250 rent -> $3800 ($3750 rounds up)",
    affordabilityHintIncomeCents(125_000) === 380_000,
  );
  // Rounds to the nearest $100: $1,675/mo -> 3x = $5,025 -> $5,000.
  ok(
    "hint: $1675 rent rounds to $5000",
    affordabilityHintIncomeCents(167_500) === 500_000,
  );
  // $1,683.33/mo -> 3x = $5,049.99 -> rounds to $5,000.
  ok(
    "hint: $1683.33 rent rounds to $5000",
    affordabilityHintIncomeCents(168_333) === 500_000,
  );
  // Rounds up at the half-hundred boundary: $1,685/mo -> 3x = $5,055 -> $5,100.
  ok(
    "hint: $1685 rent rounds to $5100",
    affordabilityHintIncomeCents(168_500) === 510_000,
  );
  // Result is always a whole-$100 multiple.
  for (const rent of [99_900, 123_400, 200_001, 333_333]) {
    const h = affordabilityHintIncomeCents(rent);
    ok(`hint: ${rent} cents -> whole $100`, h !== null && h % 10_000 === 0);
  }
  // No rent -> no suggestion.
  ok("hint: null rent -> null", affordabilityHintIncomeCents(null) === null);
  ok(
    "hint: undefined rent -> null",
    affordabilityHintIncomeCents(undefined) === null,
  );
  ok("hint: 0 rent -> null", affordabilityHintIncomeCents(0) === null);
  ok(
    "hint: negative rent -> null",
    affordabilityHintIncomeCents(-100_000) === null,
  );
}

// --- incomeRequirementMagnitude (S258) --------------------------------------
{
  // Below requirement: reported $5,200 vs 3x $2,800 = $8,400 -> short $3,200.
  const below = incomeRequirementMagnitude(520_000, 280_000, 3);
  ok("mag: below returns a result", below !== null);
  ok("mag: required = 3x rent ($8,400)", below?.requiredCents === 840_000);
  ok("mag: reported snapshot preserved", below?.reportedCents === 520_000);
  ok("mag: multiple echoed", below?.multiple === 3);
  ok("mag: below -> meetsRequirement false", below?.meetsRequirement === false);
  ok("mag: shortfall = $3,200", below?.shortfallCents === 320_000);
  ok("mag: below -> surplus 0", below?.surplusCents === 0);

  // Above requirement: reported $9,000 vs $8,400 -> surplus $600, meets.
  const above = incomeRequirementMagnitude(900_000, 280_000, 3);
  ok("mag: above -> meetsRequirement true", above?.meetsRequirement === true);
  ok("mag: above -> shortfall 0", above?.shortfallCents === 0);
  ok("mag: surplus = $600", above?.surplusCents === 60_000);

  // Exactly at requirement counts as meeting (mirrors the < test in the evaluator).
  const exact = incomeRequirementMagnitude(840_000, 280_000, 3);
  ok("mag: exactly at requirement meets", exact?.meetsRequirement === true);
  ok("mag: exact -> shortfall 0", exact?.shortfallCents === 0);
  ok("mag: exact -> surplus 0", exact?.surplusCents === 0);

  // meetsRequirement uses the UNROUNDED product (boundary one cent below fails,
  // even though requiredCents rounds to the same displayed figure).
  const justUnder = incomeRequirementMagnitude(839_999, 280_000, 3);
  ok("mag: one cent under -> fails", justUnder?.meetsRequirement === false);
  ok("mag: one cent under -> shortfall 1", justUnder?.shortfallCents === 1);

  // Fractional multiple: 2.5x $2,800 = $7,000.
  const frac = incomeRequirementMagnitude(600_000, 280_000, 2.5);
  ok("mag: 2.5x -> required $7,000", frac?.requiredCents === 700_000);
  ok("mag: 2.5x -> shortfall $1,000", frac?.shortfallCents === 100_000);

  // Non-integer cents product is rounded for display but the boolean is exact.
  // 3 x $1,683.33 = $5,049.99 -> requiredCents rounds to 504999 (already whole).
  const oddRent = incomeRequirementMagnitude(500_000, 168_333, 3);
  ok("mag: odd rent required rounds", oddRent?.requiredCents === 504_999);
  ok("mag: odd rent -> below", oddRent?.meetsRequirement === false);

  // Null / unconfigured inputs -> null (nothing to show).
  ok("mag: no income -> null", incomeRequirementMagnitude(null, 280_000, 3) === null);
  ok("mag: no rent -> null", incomeRequirementMagnitude(520_000, null, 3) === null);
  ok(
    "mag: income screening off (null multiple) -> null",
    incomeRequirementMagnitude(520_000, 280_000, null) === null,
  );
  ok("mag: zero rent -> null", incomeRequirementMagnitude(520_000, 0, 3) === null);
  ok(
    "mag: zero multiple -> null",
    incomeRequirementMagnitude(520_000, 280_000, 0) === null,
  );
  ok(
    "mag: negative income -> null",
    incomeRequirementMagnitude(-1, 280_000, 3) === null,
  );
  // Zero reported income is valid (a renter who entered $0): far below.
  const zeroIncome = incomeRequirementMagnitude(0, 280_000, 3);
  ok("mag: $0 income is a result", zeroIncome !== null);
  ok("mag: $0 income -> shortfall = full requirement", zeroIncome?.shortfallCents === 840_000);
  ok("mag: $0 income -> does not meet", zeroIncome?.meetsRequirement === false);
}

console.log(`\nscreening: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
