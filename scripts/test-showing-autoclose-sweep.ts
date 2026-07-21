// Unit tests for the S546 auto-close SWEEP layer (the pure pieces the cron relies
// on): the query-band helper + the per-row decision under sweep scenarios
// (idempotency, later-tap-wins, backlog bound, nudge-exhaustion).
// Run: npx tsx scripts/test-showing-autoclose-sweep.ts
import {
  showingAutoCloseDue,
  autoCloseSweepBand,
  AUTO_CLOSED_OUTCOME,
  AUTOCLOSE_DEFAULT_AFTER_MS,
  AUTOCLOSE_MAX_AGE_MS,
} from "../lib/showing-autoclose";
import { HOUR_MS } from "../lib/reminders";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const NOW = 5_000 * HOUR_MS; // arbitrary fixed clock

// --- autoCloseSweepBand -------------------------------------------------------
{
  const band = autoCloseSweepBand({ nowMs: NOW });
  ok("band newest = now - default after", band.newestMs === NOW - AUTOCLOSE_DEFAULT_AFTER_MS);
  ok("band oldest = now - default maxAge", band.oldestMs === NOW - AUTOCLOSE_MAX_AGE_MS);
  ok("band oldest is before newest", band.oldestMs < band.newestMs);
}
{
  const afterMs = 72 * HOUR_MS; // org configured 72h grace
  const band = autoCloseSweepBand({ nowMs: NOW, autoCloseAfterMs: afterMs });
  ok("band honours a custom after window", band.newestMs === NOW - afterMs);
  ok("custom after does not move the backlog bound", band.oldestMs === NOW - AUTOCLOSE_MAX_AGE_MS);
}

// A showing exactly at each band edge should be a real candidate (elapsed within
// [after, maxAge]) so the SQL `.gte(oldest).lte(newest)` never excludes a due row.
{
  const band = autoCloseSweepBand({ nowMs: NOW });
  const atNewest = showingAutoCloseDue({
    enabled: true,
    scheduledAtMs: band.newestMs, // elapsed == after exactly
    nowMs: NOW,
    outcome: "scheduled",
    nudgeCount: 3,
    maxNudges: 3,
  });
  ok("row at the newest edge (grace just elapsed) is due", atNewest === true);
  const atOldest = showingAutoCloseDue({
    enabled: true,
    scheduledAtMs: band.oldestMs, // elapsed == maxAge exactly
    nowMs: NOW,
    outcome: "scheduled",
    nudgeCount: 3,
    maxNudges: 3,
  });
  ok("row at the oldest edge (backlog bound) is still due", atOldest === true);
}

// --- sweep decision scenarios -------------------------------------------------
function candidate(over: Partial<Parameters<typeof showingAutoCloseDue>[0]> = {}) {
  return showingAutoCloseDue({
    enabled: true,
    scheduledAtMs: NOW - (AUTOCLOSE_DEFAULT_AFTER_MS + HOUR_MS), // just past grace
    nowMs: NOW,
    outcome: "scheduled",
    nudgeCount: 3,
    maxNudges: 3,
    ...over,
  });
}

ok("closes a passed, nudge-spent, still-scheduled showing", candidate() === true);
ok("idempotent: an already auto_closed row is not re-closed", candidate({ outcome: AUTO_CLOSED_OUTCOME }) === false);
ok("later tap wins: attended is never overwritten", candidate({ outcome: "attended" }) === false);
ok("later tap wins: no_show is never overwritten", candidate({ outcome: "no_show" }) === false);
ok("later tap wins: cancelled is never overwritten", candidate({ outcome: "cancelled" }) === false);
ok("nudge series not yet spent -> not closed", candidate({ nudgeCount: 1, maxNudges: 3 }) === false);
ok("disabled org never closes anything", candidate({ enabled: false }) === false);
ok(
  "beyond the backlog bound -> not closed (first-enable safety)",
  candidate({ scheduledAtMs: NOW - (AUTOCLOSE_MAX_AGE_MS + HOUR_MS) }) === false,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
