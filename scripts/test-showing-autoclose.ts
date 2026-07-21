// Unit tests for S546 showing-outcome auto-close default.
// Run: npx tsx scripts/test-showing-autoclose.ts
import {
  showingAutoCloseDue,
  AUTO_CLOSED_OUTCOME,
  AUTOCLOSE_DEFAULT_AFTER_MS,
  AUTOCLOSE_MAX_AGE_MS,
} from "../lib/showing-autoclose";
import { HOUR_MS } from "../lib/reminders";
import { SHOWING_OUTCOMES, showingOutcomeLabel } from "../lib/pipeline";
import { buildShowingReport } from "../lib/reports";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const NOW = 1_000 * HOUR_MS; // arbitrary fixed clock
function base(over: Partial<Parameters<typeof showingAutoCloseDue>[0]> = {}) {
  return {
    enabled: true,
    scheduledAtMs: NOW - (AUTOCLOSE_DEFAULT_AFTER_MS + HOUR_MS), // grace elapsed
    nowMs: NOW,
    outcome: "scheduled" as string | null,
    nudgeCount: 3,
    maxNudges: 3,
    ...over,
  };
}

// --- the happy path -----------------------------------------------------------
ok("due when opted in, nudges spent, grace elapsed, still scheduled", showingAutoCloseDue(base()) === true);
ok("due when outcome is null (never touched)", showingAutoCloseDue(base({ outcome: null })) === true);

// --- gates --------------------------------------------------------------------
ok("not due when disabled", showingAutoCloseDue(base({ enabled: false })) === false);
ok("not due when a real outcome recorded (attended)", showingAutoCloseDue(base({ outcome: "attended" })) === false);
ok("not due when a real outcome recorded (no_show)", showingAutoCloseDue(base({ outcome: "no_show" })) === false);
ok("not due when cancelled", showingAutoCloseDue(base({ outcome: "cancelled" })) === false);
ok("not due when already auto_closed", showingAutoCloseDue(base({ outcome: "auto_closed" })) === false);
ok("not due while nudge series not exhausted", showingAutoCloseDue(base({ nudgeCount: 2, maxNudges: 3 })) === false);
ok("not due before grace elapses", showingAutoCloseDue(base({ scheduledAtMs: NOW - (AUTOCLOSE_DEFAULT_AFTER_MS - HOUR_MS) })) === false);
ok("not due once older than the backlog bound", showingAutoCloseDue(base({ scheduledAtMs: NOW - (AUTOCLOSE_MAX_AGE_MS + HOUR_MS) })) === false);

// --- honours the org's cadence: max=1 exhausts after a single nudge ----------
ok("one-nudge org: due after the single nudge", showingAutoCloseDue(base({ nudgeCount: 1, maxNudges: 1 })) === true);
ok("one-nudge org: not due before the single nudge", showingAutoCloseDue(base({ nudgeCount: 0, maxNudges: 1 })) === false);

// --- configurable grace -------------------------------------------------------
{
  const after = 72 * HOUR_MS;
  ok("custom grace respected: not due at 48h", showingAutoCloseDue(base({ autoCloseAfterMs: after, scheduledAtMs: NOW - 48 * HOUR_MS })) === false);
  ok("custom grace respected: due at 73h", showingAutoCloseDue(base({ autoCloseAfterMs: after, scheduledAtMs: NOW - 73 * HOUR_MS })) === true);
}

// --- the value + label + enum ------------------------------------------------
ok("auto_closed is a known outcome", (SHOWING_OUTCOMES as readonly string[]).includes(AUTO_CLOSED_OUTCOME));
ok("auto_closed has an honest label", showingOutcomeLabel(AUTO_CLOSED_OUTCOME) === "Auto-closed (no outcome recorded)");

// --- the report never counts auto_closed toward attendance -------------------
{
  const nowMs = 2_000 * HOUR_MS;
  const past = new Date(nowMs - 5 * HOUR_MS).toISOString();
  const report = buildShowingReport(
    [
      { outcome: "attended", scheduled_at: past },
      { outcome: "attended", scheduled_at: past },
      { outcome: "no_show", scheduled_at: past },
      { outcome: "auto_closed", scheduled_at: past },
      { outcome: "auto_closed", scheduled_at: past },
      { outcome: "auto_closed", scheduled_at: past },
    ] as Parameters<typeof buildShowingReport>[0],
    nowMs,
  );
  ok("report counts auto_closed in its own bucket", report.autoClosed === 3);
  ok("attendanceRate excludes auto_closed (2 of 3 = 67%)", report.attendanceRate === 67);
  ok("total counts every showing", report.total === 6);
}

console.log(`showing-autoclose: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
