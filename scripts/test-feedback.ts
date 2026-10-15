// Unit tests for the pure feedback-due logic. Run: npx tsx scripts/test-feedback.ts
import { feedbackDue, HOUR_MS, FEEDBACK_MAX_AGE_HOURS, feedbackAlertVars, viewingNotYet } from "../lib/feedback";
import { getNotificationEvent, renderNotification } from "../lib/notifications";

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

// --- S718: the feedback alert email -------------------------------------
{
  const low = feedbackAlertVars({ rating: 2, comments: "  too small " });
  ok("alert: 2 stars is flagged", low.rating_flag === "Low rating: ");
  ok("alert: stars drawn", low.rating_stars === "\u2605\u2605\u2606\u2606\u2606");
  ok("alert: comment trimmed and quoted", low.comments === '"too small"');
  const one = feedbackAlertVars({ rating: 1, comments: null });
  ok("alert: 1 star flagged", one.rating_flag === "Low rating: ");
  ok("alert: blank comment reads (no comment)", one.comments === "(no comment)");
  const three = feedbackAlertVars({ rating: 3, comments: "" });
  ok("alert: 3 stars not flagged", three.rating_flag === "");
  ok("alert: out of range clamps", feedbackAlertVars({ rating: 9, comments: "" }).rating === "5");

  const ev = getNotificationEvent("leasing.viewing_feedback");
  ok("event: registered and active", !!ev && ev.active);
  ok("event: showing lane", ev?.lane === "showing");
  if (ev) {
    const vars = {
      org_name: "S712 Test Rentals",
      property_address: "12 Test St",
      lead_name: "Renter Five",
      showing_time: "Wed, Oct 14, 5:00 PM",
      dashboard_url: "https://app.vacantless.com/dashboard/leads/x",
    };
    const rLow = renderNotification(ev, null, { ...vars, ...low });
    ok("render: low subject", rLow.subject === "Low rating: Viewing feedback from Renter Five: 2 of 5");
    ok("render: body has comment", rLow.body.includes('Comment: "too small"'));
    ok("render: body has link", rLow.body.includes("dashboard/leads/x"));
    const rOk = renderNotification(ev, null, { ...vars, ...feedbackAlertVars({ rating: 4, comments: "I need a bigger unit" }) });
    ok("render: normal subject has no flag", rOk.subject === "Viewing feedback from Renter Five: 4 of 5");
    ok("render: no em dash", !/\u2014/.test(rOk.subject + rOk.body + ev.description));
    ok("render: no leftover tokens", !/{{/.test(rOk.subject + rOk.body));
  }
}

// S720: the /f page shows "not yet" before the viewing.
{
  const now = Date.parse("2026-10-15T14:30:00Z");
  ok("notYet: tomorrow's viewing", viewingNotYet("2026-10-16T21:00:00+00", now) === true);
  ok("notYet: past viewing", viewingNotYet("2026-10-14T21:00:00+00", now) === false);
  ok("notYet: exactly now is not future", viewingNotYet("2026-10-15T14:30:00Z", now) === false);
  ok("notYet: supabase-js form", viewingNotYet("2026-10-16T21:00:00+00:00", now) === true);
  ok("notYet: null time", viewingNotYet(null, now) === false);
  ok("notYet: garbage time", viewingNotYet("not a date", now) === false);
}

console.log(`\nfeedback: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
