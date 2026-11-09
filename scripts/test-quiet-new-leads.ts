// S771: "New" to "Contacted" after 3 quiet days. Run: npx tsx scripts/test-quiet-new-leads.ts
import { shouldMoveToContacted, QUIET_MS, QUIET_MAX_AGE_MS, QUIET_MOVE_NOTE } from "../lib/quiet-new-leads";
import { SWEEP_PATHS } from "../lib/cron-sweeps";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL: ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
}
const NOW = Date.UTC(2026, 10, 9, 18, 0, 0);
const b = (o: Partial<Parameters<typeof shouldMoveToContacted>[0]> = {}) =>
  shouldMoveToContacted({ status: "new", createdAtMs: NOW - QUIET_MS - 1, nowMs: NOW, hasOutboundReply: true, ...o });

eq("answered, 3 days quiet: moves", b(), true);
eq("exactly 3 days: moves", b({ createdAtMs: NOW - QUIET_MS }), true);
eq("under 3 days: stays", b({ createdAtMs: NOW - QUIET_MS + 1 }), false);
eq("never answered: stays New", b({ hasOutboundReply: false }), false);
for (const s of ["replied", "contacted", "booked", "showed", "applied", "leased", "lost", null, undefined, ""]) {
  eq(`status ${String(s)} is never touched`, b({ status: s as string | null }), false);
}
eq("no created date: stays", b({ createdAtMs: null }), false);
eq("older than 30 days: left alone", b({ createdAtMs: NOW - QUIET_MAX_AGE_MS - 1 }), false);
eq("30 days exactly: moves", b({ createdAtMs: NOW - QUIET_MAX_AGE_MS }), true);
eq("sweep is on the timer list", (SWEEP_PATHS as readonly string[]).includes("/api/cron/quiet-new-leads"), true);
eq("note has no em dash", QUIET_MOVE_NOTE.includes(String.fromCharCode(0x2014)), false);

console.log(`quiet-new-leads: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
