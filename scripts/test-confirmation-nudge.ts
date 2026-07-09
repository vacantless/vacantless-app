// Run with: npx tsx scripts/test-confirmation-nudge.ts
//
// Tests the pure pre-showing UNCONFIRMED-nudge decision (S440, Slice 3):
// confirmationNudgeDue (assigned + unconfirmed + open outcome, within the 24h
// lead window, future-only, single-stamp idempotency) + the constants. No I/O.
import {
  confirmationNudgeDue,
  CONFIRMATION_NUDGE_SENT_COLUMN,
  CONFIRMATION_NUDGE_LEAD_MS,
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
// scheduled time that is `hoursAhead` hours in the future (negative = past)
const ahead = (hoursAhead: number) => now + hoursAhead * HOUR_MS;

const base = {
  nowMs: now,
  assigned: true,
  confirmed: false,
  outcome: null as string | null,
  alreadySent: false,
};

// --- the happy path: assigned, unconfirmed, open, within 24h, in the future ---
ok(
  "in 3h, assigned, unconfirmed → DUE",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3) }) === true,
);
ok(
  'placeholder outcome "scheduled" counts as open → DUE',
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), outcome: "scheduled" }) === true,
);

// --- not assigned → nothing to confirm ---
ok(
  "unassigned → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), assigned: false }) === false,
);

// --- already confirmed → not due ---
ok(
  "confirmed → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), confirmed: true }) === false,
);

// --- a real outcome already recorded (closed) → never nudge ---
ok(
  "cancelled → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), outcome: "cancelled" }) === false,
);
ok(
  "attended → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), outcome: "attended" }) === false,
);
ok(
  "no_show → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), outcome: "no_show" }) === false,
);

// --- single nudge per showing ---
ok(
  "already sent → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(3), alreadySent: true }) === false,
);

// --- timing: future-only, within the lead window ---
ok(
  "start already passed (1h ago) → not due (outcome-nudge territory)",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(-1) }) === false,
);
ok(
  "25h out (> 24h lead) → not due (too early)",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(25) }) === false,
);

// --- inclusive boundaries ---
ok(
  "exactly at lead window (24h out) → DUE (inclusive)",
  confirmationNudgeDue({ ...base, scheduledAtMs: now + CONFIRMATION_NUDGE_LEAD_MS }) === true,
);
ok(
  "1ms past the lead window → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: now + CONFIRMATION_NUDGE_LEAD_MS + 1 }) === false,
);
ok(
  "right at the start (remaining 0) → DUE (inclusive)",
  confirmationNudgeDue({ ...base, scheduledAtMs: now }) === true,
);

// --- caller can override the window ---
ok(
  "custom lead 48h → a 30h-out showing is due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(30), leadMs: 48 * HOUR_MS }) === true,
);

// --- constants ---
ok("sent column name", CONFIRMATION_NUDGE_SENT_COLUMN === "confirmation_nudge_sent_at");
ok("lead window is 24h", CONFIRMATION_NUDGE_LEAD_MS === 24 * HOUR_MS);

console.log(`\nconfirmation-nudge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
