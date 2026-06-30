// Run with: npx tsx scripts/test-outcome-nudge.ts
//
// Tests the pure post-showing outcome-nudge decision (S391, Slice 1):
// outcomeNudgeDue (grace window, max-age backlog bound, blank/"scheduled" only,
// single-stamp idempotency, catch-up safe) + the sent-column constant. No I/O.
import {
  outcomeNudgeDue,
  OUTCOME_NUDGE_SENT_COLUMN,
  OUTCOME_NUDGE_GRACE_MS,
  OUTCOME_NUDGE_MAX_AGE_MS,
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
ok("grace is 2h", OUTCOME_NUDGE_GRACE_MS === 2 * HOUR_MS);
ok("max age is 7d", OUTCOME_NUDGE_MAX_AGE_MS === 7 * 24 * HOUR_MS);

console.log(`\noutcome-nudge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
