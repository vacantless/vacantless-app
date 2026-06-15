// Unit tests for the pure feedback-due logic. Run: npx tsx scripts/test-feedback.ts
import { feedbackDue, HOUR_MS, FEEDBACK_MAX_AGE_HOURS } from "../lib/feedback";

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

const NOW = Date.parse("2026-06-15T18:00:00Z");
const base = {
  nowMs: NOW,
  outcome: "attended",
  requestSent: false,
  delayHours: 2,
  enabled: true,
};

// --- Core happy path -------------------------------------------------------
ok(
  "due exactly at scheduled + delay",
  feedbackDue({ ...base, scheduledAtMs: NOW - 2 * HOUR_MS }),
);
ok(
  "due well after the delay (catch-up)",
  feedbackDue({ ...base, scheduledAtMs: NOW - 10 * HOUR_MS }),
);
ok(
  "not due before the delay elapses",
  !feedbackDue({ ...base, scheduledAtMs: NOW - 1 * HOUR_MS }),
);
ok(
  "not due one ms before the delay boundary",
  !feedbackDue({ ...base, scheduledAtMs: NOW - 2 * HOUR_MS + 1 }),
);

// --- Outcome gating --------------------------------------------------------
for (const outcome of ["scheduled", "no_show", "cancelled", "weird", ""]) {
  ok(
    `outcome '${outcome}' never triggers`,
    !feedbackDue({ ...base, outcome, scheduledAtMs: NOW - 5 * HOUR_MS }),
  );
}
ok(
  "outcome 'attended' triggers",
  feedbackDue({ ...base, outcome: "attended", scheduledAtMs: NOW - 5 * HOUR_MS }),
);

// --- Idempotency -----------------------------------------------------------
ok(
  "already sent never re-triggers",
  !feedbackDue({ ...base, requestSent: true, scheduledAtMs: NOW - 5 * HOUR_MS }),
);

// --- Enabled switch --------------------------------------------------------
ok(
  "disabled org never triggers",
  !feedbackDue({ ...base, enabled: false, scheduledAtMs: NOW - 5 * HOUR_MS }),
);

// --- Null scheduled --------------------------------------------------------
ok("null scheduled time never triggers", !feedbackDue({ ...base, scheduledAtMs: null }));

// --- Freshness cap ---------------------------------------------------------
ok(
  "due just inside the max-age window",
  feedbackDue({
    ...base,
    scheduledAtMs: NOW - (FEEDBACK_MAX_AGE_HOURS - 1) * HOUR_MS,
  }),
);
ok(
  "not due just past the max-age window",
  !feedbackDue({
    ...base,
    scheduledAtMs: NOW - (FEEDBACK_MAX_AGE_HOURS + 1) * HOUR_MS,
  }),
);
ok(
  "future scheduled time (elapsed negative) never triggers",
  !feedbackDue({ ...base, scheduledAtMs: NOW + 3 * HOUR_MS }),
);

// --- Delay edge cases ------------------------------------------------------
ok(
  "zero delay → due immediately after the showing",
  feedbackDue({ ...base, delayHours: 0, scheduledAtMs: NOW - 1 }),
);
ok(
  "negative delay floored to 0 (due just after)",
  feedbackDue({ ...base, delayHours: -5, scheduledAtMs: NOW - 1 }),
);
ok(
  "NaN delay floored to 0 (due just after)",
  feedbackDue({ ...base, delayHours: NaN, scheduledAtMs: NOW - 1 }),
);
ok(
  "large delay not yet elapsed → not due",
  !feedbackDue({ ...base, delayHours: 48, scheduledAtMs: NOW - 5 * HOUR_MS }),
);

console.log(`\nfeedback: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
