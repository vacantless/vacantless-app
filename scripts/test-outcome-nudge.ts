// Run with: npx tsx scripts/test-outcome-nudge.ts
//
// Tests the pure post-showing outcome-nudge decision (S391, Slice 1):
// outcomeNudgeDue (grace window, max-age backlog bound, blank/"scheduled" only,
// single-stamp idempotency, catch-up safe) + the sent-column constant. No I/O.
import {
  outcomeNudgeDue,
  outcomeNudgeStepDue,
  OUTCOME_NUDGE_SENT_COLUMN,
  OUTCOME_NUDGE_COUNT_COLUMN,
  OUTCOME_NUDGE_GRACE_MS,
  OUTCOME_NUDGE_MAX_AGE_MS,
  OUTCOME_NUDGE_OFFSETS_MS,
  HOUR_MS,
} from "../lib/reminders";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const now = 1_000_000_000_000; // fixed "now"
// scheduled time that is `hoursAgo` hours before now (negative = in the future)
const ago = (hoursAgo: number) => now - hoursAgo * HOUR_MS;

const base = { nowMs: now, outcome: null as string | null, alreadySent: false };

// --- not over yet (inside the grace window) ---
ok(
  "future showing → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(-3) }) === false,
);
ok(
  "just started (0h ago) → not due (within grace)",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(0) }) === false,
);
ok(
  "1h ago (< 2h grace) → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(1) }) === false,
);

// --- the happy path: over, blank, not yet nudged ---
ok(
  "3h ago, blank, not sent → DUE",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3) }) === true,
);
ok(
  'placeholder outcome "scheduled" counts as not-recorded → DUE',
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3), outcome: "scheduled" }) === true,
);

// --- a real outcome already recorded → never nudge ---
ok(
  "attended → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3), outcome: "attended" }) === false,
);
ok(
  "no_show → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3), outcome: "no_show" }) === false,
);
ok(
  "cancelled → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3), outcome: "cancelled" }) === false,
);

// --- single nudge per showing ---
ok(
  "already sent → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3), alreadySent: true }) === false,
);

// --- backlog bound: too old → not due ---
ok(
  "8 days ago (> 7d max age) → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(8 * 24) }) === false,
);
ok(
  "catch-up: 3 days ago, blank, not sent → still DUE (within max age)",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(3 * 24) }) === true,
);

// --- inclusive boundaries ---
ok(
  "exactly at grace (2h ago) → DUE (inclusive)",
  outcomeNudgeDue({ ...base, scheduledAtMs: now - OUTCOME_NUDGE_GRACE_MS }) === true,
);
ok(
  "exactly at max age (7d ago) → DUE (inclusive)",
  outcomeNudgeDue({ ...base, scheduledAtMs: now - OUTCOME_NUDGE_MAX_AGE_MS }) === true,
);
ok(
  "1ms past max age → not due",
  outcomeNudgeDue({ ...base, scheduledAtMs: now - OUTCOME_NUDGE_MAX_AGE_MS - 1 }) === false,
);

// --- caller can override the windows ---
ok(
  "custom grace 0 → a just-passed showing is due",
  outcomeNudgeDue({ ...base, scheduledAtMs: ago(0.1), graceMs: 0 }) === true,
);

// --- the stamp column constant ---
ok("sent column name", OUTCOME_NUDGE_SENT_COLUMN === "outcome_nudge_sent_at");
ok("count column name", OUTCOME_NUDGE_COUNT_COLUMN === "outcome_nudge_count");
ok("grace is 2h", OUTCOME_NUDGE_GRACE_MS === 2 * HOUR_MS);
ok("max age is 7d", OUTCOME_NUDGE_MAX_AGE_MS === 7 * 24 * HOUR_MS);

// ===========================================================================
// Bounded escalation — outcomeNudgeStepDue (S445 slice 2)
// ===========================================================================
const [OFF1, OFF2, OFF3] = OUTCOME_NUDGE_OFFSETS_MS;
ok("three offsets, ascending", OUTCOME_NUDGE_OFFSETS_MS.length === 3 && OFF1 < OFF2 && OFF2 < OFF3);
ok("first offset is the grace", OFF1 === OUTCOME_NUDGE_GRACE_MS);

const step = (o: Partial<Parameters<typeof outcomeNudgeStepDue>[0]> & { scheduledAtMs: number }) =>
  outcomeNudgeStepDue({ nowMs: now, outcome: null, nudgeCount: 0, maxNudges: 3, ...o });

// Step 1 (count 0): due once elapsed crosses OFF1, not before.
ok("count 0, before OFF1 → not due", step({ scheduledAtMs: now - OFF1 + 1 }) === false);
ok("count 0, at OFF1 → due (step 1)", step({ scheduledAtMs: now - OFF1 }) === true);

// Step 2 (count 1): waits for OFF2 even though OFF1 long passed.
ok("count 1, only OFF1 elapsed → not due yet", step({ scheduledAtMs: now - OFF1, nudgeCount: 1 }) === false);
ok("count 1, at OFF2 → due (step 2)", step({ scheduledAtMs: now - OFF2, nudgeCount: 1 }) === true);

// Step 3 (count 2): waits for OFF3.
ok("count 2, only OFF2 elapsed → not due yet", step({ scheduledAtMs: now - OFF2, nudgeCount: 2 }) === false);
ok("count 2, at OFF3 → due (step 3, final)", step({ scheduledAtMs: now - OFF3, nudgeCount: 2 }) === true);

// The cadence cap: "just once" (max 1) sends step 1 only, never step 2.
ok("max 1: count 0 at OFF1 → due", step({ scheduledAtMs: now - OFF1, maxNudges: 1 }) === true);
ok("max 1: count 1 → capped, never again", step({ scheduledAtMs: now - OFF3, nudgeCount: 1, maxNudges: 1 }) === false);

// Follow-up cap (max 3): after 3 sent, no fourth step.
ok("max 3: count 3 → capped (no 4th)", step({ scheduledAtMs: now - OFF3, nudgeCount: 3 }) === false);
ok("count >= offsets.length → not due (no step defined)", step({ scheduledAtMs: now - OFF3, nudgeCount: 3, maxNudges: 5 }) === false);

// Recording the outcome stops the whole series regardless of count/step.
ok("attended → never due (any step)", step({ scheduledAtMs: now - OFF2, nudgeCount: 1, outcome: "attended" }) === false);
ok("no_show → never due", step({ scheduledAtMs: now - OFF3, nudgeCount: 2, outcome: "no_show" }) === false);
ok('"scheduled" placeholder still nudges', step({ scheduledAtMs: now - OFF1, outcome: "scheduled" }) === true);

// Backlog bound still caps the series: too old → not due even at step 1.
ok("older than max age → not due", step({ scheduledAtMs: now - OUTCOME_NUDGE_MAX_AGE_MS - 1 }) === false);
ok("all three steps sit inside the 7d backlog bound", OFF3 <= OUTCOME_NUDGE_MAX_AGE_MS);

console.log(`\noutcome-nudge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
