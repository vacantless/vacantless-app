// ============================================================================
// Candidate pre-screening (S240, the leasing-wedge feature).
//
// Captures a few structured qualifying answers on the public inquiry (income,
// occupants, pets — move-in already lives on the lead) and computes an auto
// "qualify-out" flag against the org's configured criteria, so the operator can
// see at a glance which inquiries are unlikely to fit before spending time on
// them. It is a SOFT signal: it never rejects a renter or hides a lead, it only
// surfaces a reason. The operator decides.
//
// This module is PURE (no DOM/env/IO) so it can be unit-tested AND so the exact
// same logic can run client-side (a live preview) and server-side. The
// authoritative computation happens inside the submit_public_lead RPC, which
// MUST mirror this logic byte-for-byte (the anon-RPC-re-validate rule); the
// stored qualified_out / qualify_out_reasons are a SNAPSHOT taken at intake so
// later changes to the org's criteria never silently rewrite an old lead.
//
// Fair-housing note: the criteria here are deliberately limited to legitimate,
// non-protected business factors — ability to afford the rent (income vs rent),
// move-in timing, and a pet match against an explicitly not-pet-friendly unit.
// Occupant count is CAPTURED for the operator's context but never drives a
// qualify-out, because occupancy screening risks discriminating on family
// status. Do not add protected-class factors to this evaluator.
// ============================================================================

// Canonical qualify-out reason strings. These are STORED (leads.qualify_out_reasons)
// and rendered to the operator, and the SQL RPC produces the identical strings —
// keep the two in lockstep. No apostrophes (keeps the SQL literals simple).
export const SCREENING_REASON = {
  income: "Income below your requirement",
  moveIn: "Move-in later than your window",
  pets: "Has pets; rental is not pet-friendly",
} as const;

export type ScreeningReason =
  (typeof SCREENING_REASON)[keyof typeof SCREENING_REASON];

// --- org-level configuration (organizations.*) ------------------------------
export type OrgScreeningConfig = {
  /** Master switch. When false, nothing is asked and nothing is flagged. */
  screening_enabled: boolean;
  /**
   * Require the renter's monthly income to be at least this multiple of the
   * monthly rent (e.g. 3.0 = income >= 3x rent). null = do not screen on income.
   */
  screening_income_multiple: number | null;
  /**
   * Flag an inquiry whose desired move-in is more than this many days out from
   * today (a renter who wants to move in far later than you need the unit
   * filled). null = do not screen on move-in timing.
   */
  screening_max_movein_days: number | null;
  /**
   * When true, flag a renter who has pets inquiring about a unit that is not
   * pet-friendly. (A pet-friendly unit is never flagged.)
   */
  screening_flag_pets: boolean;
};

// --- the rental's relevant facts -------------------------------------------
export type ScreeningContext = {
  rent_cents: number | null;
  pet_friendly: boolean;
};

// --- the renter's answers ---------------------------------------------------
export type ScreeningAnswers = {
  /** Self-reported monthly household income, in cents. null = not provided. */
  income_cents: number | null;
  /** Whether the renter indicated they have pets. */
  has_pets: boolean | null;
  /** Desired move-in date, "YYYY-MM-DD". null = not provided. */
  move_in: string | null;
};

export type ScreeningResult = {
  qualifiedOut: boolean;
  reasons: string[];
};

/** Parse a "YYYY-MM-DD" string to a UTC-midnight epoch day number, or null. */
function dayNumber(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const v = isoDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

/** Whole-day difference (date - today); null when either is missing/invalid. */
function daysUntil(isoDate: string | null, today: string): number | null {
  const due = dayNumber(isoDate);
  const now = dayNumber(today);
  if (due === null || now === null) return null;
  return due - now;
}

/**
 * Evaluate an inquiry against the org's screening criteria. Returns the set of
 * qualify-out reasons (empty = passes / qualifies). Missing answers never cause
 * a flag — you can only fail a criterion you answered. Mirrors the SQL in
 * migration 0044's submit_public_lead.
 */
export function evaluateScreening(
  config: OrgScreeningConfig,
  ctx: ScreeningContext,
  answers: ScreeningAnswers,
  today: string,
): ScreeningResult {
  const reasons: string[] = [];
  if (!config.screening_enabled) return { qualifiedOut: false, reasons };

  // Income: renter's monthly income below (multiple x monthly rent).
  if (
    config.screening_income_multiple != null &&
    config.screening_income_multiple > 0 &&
    answers.income_cents != null &&
    ctx.rent_cents != null &&
    ctx.rent_cents > 0 &&
    answers.income_cents < config.screening_income_multiple * ctx.rent_cents
  ) {
    reasons.push(SCREENING_REASON.income);
  }

  // Move-in timing: desired move-in further out than the configured window.
  if (config.screening_max_movein_days != null) {
    const diff = daysUntil(answers.move_in, today);
    if (diff != null && diff > config.screening_max_movein_days) {
      reasons.push(SCREENING_REASON.moveIn);
    }
  }

  // Pets: has pets, unit is not pet-friendly.
  if (
    config.screening_flag_pets &&
    !ctx.pet_friendly &&
    answers.has_pets === true
  ) {
    reasons.push(SCREENING_REASON.pets);
  }

  return { qualifiedOut: reasons.length > 0, reasons };
}

// --- input validation / parsing (Settings + the public form) ---------------

export type ScreeningSettingsInput = {
  enabled: boolean;
  income_multiple: string;
  max_movein_days: string;
  flag_pets: boolean;
};

export type ScreeningSettingsResult =
  | { ok: true; values: OrgScreeningConfig }
  | { ok: false; reason: "income_multiple" | "max_movein_days" };

/**
 * Validate + normalize the Settings screening form. An empty income-multiple or
 * max-move-in field means "don't screen on that" (-> null). A present value must
 * be a sensible positive number. Income multiple capped at 20x, window at
 * 3650 days, to catch fat-finger entries.
 */
export function validateScreeningSettings(
  input: ScreeningSettingsInput,
): ScreeningSettingsResult {
  let income_multiple: number | null = null;
  const im = input.income_multiple.trim();
  if (im !== "") {
    const n = Number(im);
    if (!Number.isFinite(n) || n <= 0 || n > 20) {
      return { ok: false, reason: "income_multiple" };
    }
    // Keep two decimals (matches numeric(4,2) in the column).
    income_multiple = Math.round(n * 100) / 100;
  }

  let max_movein_days: number | null = null;
  const md = input.max_movein_days.trim();
  if (md !== "") {
    const n = Number(md);
    if (!Number.isInteger(n) || n <= 0 || n > 3650) {
      return { ok: false, reason: "max_movein_days" };
    }
    max_movein_days = n;
  }

  return {
    ok: true,
    values: {
      screening_enabled: input.enabled,
      screening_income_multiple: income_multiple,
      screening_max_movein_days: max_movein_days,
      screening_flag_pets: input.flag_pets,
    },
  };
}

/**
 * Parse a renter-entered monthly income (dollars, possibly with $ / commas) to
 * integer cents, or null when blank/invalid. Tolerant of "4,500", "$4500",
 * "4500.00". Negative or non-numeric -> null (treated as not provided).
 */
export function parseIncomeToCents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Parse a small non-negative integer (occupants), else null. */
export function parseCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  return n;
}

// --- inquiries-list screening filter (S245) ---------------------------------
// The qualify-out flag is a SNAPSHOT (leads.qualified_out). On the Inquiries
// list the operator wants to triage by it: focus on good fits, or pull up the
// possible mismatches to review. This filter is orthogonal to the stage filter
// (both can be active at once) and lives in the URL as ?screen=ok|out.
//
//   "out" = only the qualified-out (possible mismatch) leads
//   "ok"  = only the leads that did NOT qualify out (everything else)
//   null  = no screening filter (show all)
//
// Pure so the list page stays a thin render over it.
export type ScreenFilter = "out" | "ok";

export function isScreenFilter(
  value: string | null | undefined,
): value is ScreenFilter {
  return value === "out" || value === "ok";
}

/**
 * Does a lead's qualify-out snapshot match the active screening filter? A null
 * filter matches everything. Note "ok" deliberately includes leads that were
 * never screened (qualified_out = false), so an org that has never enabled
 * screening sees all of its leads under "Good fits".
 */
export function matchesScreenFilter(
  qualifiedOut: boolean,
  filter: ScreenFilter | null,
): boolean {
  if (filter === "out") return qualifiedOut === true;
  if (filter === "ok") return qualifiedOut === false;
  return true;
}
