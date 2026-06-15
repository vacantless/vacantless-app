// Run with: npx tsx scripts/test-nurture.ts
import {
  nurtureStepDue,
  nurtureCopy,
  isNurturableStatus,
  STEP_THRESHOLD_HOURS,
  NURTURE_STEPS,
  MIN_GAP_HOURS,
  NURTURE_MAX_AGE_MS,
  HOUR_MS,
} from "../lib/nurture";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`);
  }
}

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // fixed "now"
const hoursAgo = (h: number) => NOW - h * HOUR_MS;

// Base input: a fresh-enough lead that has had nothing sent yet.
function base(overrides: Partial<Parameters<typeof nurtureStepDue>[0]> = {}) {
  return nurtureStepDue({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[0] + 1), // just past step-1 threshold
    nowMs: NOW,
    status: "new",
    stepsSent: 0,
    lastSentAtMs: null,
    enabled: true,
    ...overrides,
  });
}

// --- isNurturableStatus ---
eq("status new nurturable", isNurturableStatus("new"), true);
eq("status replied nurturable", isNurturableStatus("replied"), true);
eq("status contacted nurturable", isNurturableStatus("contacted"), true);
eq("status booked NOT nurturable", isNurturableStatus("booked"), false);
eq("status showed NOT nurturable", isNurturableStatus("showed"), false);
eq("status applied NOT nurturable", isNurturableStatus("applied"), false);
eq("status leased NOT nurturable", isNurturableStatus("leased"), false);
eq("status lost NOT nurturable", isNurturableStatus("lost"), false);
eq("status null NOT nurturable", isNurturableStatus(null), false);

// --- gating: enabled / status / completion ---
eq("disabled org → 0", base({ enabled: false }), 0);
eq("booked lead → 0", base({ status: "booked" }), 0);
eq("lost lead → 0", base({ status: "lost" }), 0);
eq("all steps sent → 0", base({ stepsSent: NURTURE_STEPS }), 0);
eq("more than all steps sent → 0", base({ stepsSent: NURTURE_STEPS + 5 }), 0);
eq("null createdAt → 0", base({ createdAtMs: null }), 0);

// --- step 1 cadence boundary ---
eq(
  "step1 just before threshold → 0",
  base({ createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[0] - 1) }),
  0,
);
eq(
  "step1 exactly at threshold → 1",
  base({ createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[0]) }),
  1,
);
eq("step1 well past threshold → 1", base(), 1);

// --- step 2: needs step1 already sent + its own threshold + pacing ---
eq(
  "step2 threshold passed, paced ok → 2",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS + 1),
  }),
  2,
);
eq(
  "step2 threshold not yet reached → 0",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] - 5),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS + 1),
  }),
  0,
);

// --- pacing: too soon since last send ---
eq(
  "paced: last send too recent → 0",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS - 1), // inside the gap
  }),
  0,
);
eq(
  "paced: last send exactly at gap → 2",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS),
  }),
  2,
);

// --- step 3 ---
eq(
  "step3 due → 3",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[2] + 1),
    stepsSent: 2,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS + 1),
  }),
  3,
);

// --- catch-up only advances ONE step at a time ---
// A very old-but-still-fresh lead with nothing sent should return step 1, not 3.
eq(
  "catch-up sends step1 first even if all thresholds passed",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[2] + 1),
    stepsSent: 0,
    lastSentAtMs: null,
  }),
  1,
);

// --- freshness cap ---
const maxAgeHours = NURTURE_MAX_AGE_MS / HOUR_MS;
eq(
  "freshness: just inside cap → 1",
  base({ createdAtMs: hoursAgo(maxAgeHours - 1), stepsSent: 0, lastSentAtMs: null }),
  1,
);
eq(
  "freshness: just past cap → 0",
  base({ createdAtMs: hoursAgo(maxAgeHours + 1), stepsSent: 0, lastSentAtMs: null }),
  0,
);

// --- defensive: inquiry in the future ---
eq("future inquiry → 0", base({ createdAtMs: NOW + 5 * HOUR_MS }), 0);

// --- malformed stepsSent clamps to 0 (treats as step 1 if due) ---
eq("negative stepsSent treated as 0 → 1", base({ stepsSent: -3 }), 1);

// --- nurtureCopy ---
for (let s = 1; s <= NURTURE_STEPS; s++) {
  const c = nurtureCopy(s);
  eq(`copy step ${s} subject non-empty`, c.subject.length > 0, true);
  eq(`copy step ${s} lead non-empty`, c.lead.length > 0, true);
  eq(`copy step ${s} cta non-empty`, c.cta.length > 0, true);
}
eq("copy steps 1 and 2 differ", nurtureCopy(1).lead !== nurtureCopy(2).lead, true);
eq("copy steps 2 and 3 differ", nurtureCopy(2).lead !== nurtureCopy(3).lead, true);
eq("copy out-of-range falls back to step 1", nurtureCopy(99).lead, nurtureCopy(1).lead);
eq("copy step 0 falls back to step 1", nurtureCopy(0).subject, nurtureCopy(1).subject);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
