// Unit tests for the rent-increase reminder sweep's pure selection + idempotency
// logic (S339). Run: npx tsx scripts/test-rent-increase-sweep.ts
import { deriveRentIncrease } from "../lib/rent-increase";
import {
  decideRentIncreaseNudge,
  isActionableRentIncrease,
  RENT_INCREASE_NUDGE_STATUSES,
  RENT_INCREASE_URGENCY,
} from "../lib/rent-increase-sweep";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// Helper: derive a result for a tenancy starting 2025-03-01 ($2,000) as of `today`.
function at(today: string, over: { lastIncreaseDate?: string | null; exempt?: boolean } = {}) {
  return deriveRentIncrease(
    {
      startDate: "2025-03-01",
      currentRentCents: 200000,
      lastIncreaseDate: over.lastIncreaseDate ?? null,
      exempt: over.exempt,
    },
    today,
  );
}

// --- the actionable band is exactly serve_window / serve_late / overdue -------
ok(
  "nudge statuses are the actionable band",
  RENT_INCREASE_NUDGE_STATUSES.slice().sort().join(",") ===
    ["overdue", "serve_late", "serve_window"].join(","),
);

// scheduled (far out) is NOT actionable
ok("scheduled -> not actionable", !isActionableRentIncrease(at("2025-06-01"))); // ~273d out
// serve_window (~100d out) IS actionable
ok("serve_window -> actionable", isActionableRentIncrease(at("2025-11-21")));
// serve_late (~60d out) IS actionable
ok("serve_late -> actionable", isActionableRentIncrease(at("2025-12-31")));
// overdue (past eligible) IS actionable
ok("overdue -> actionable", isActionableRentIncrease(at("2026-05-01")));
// exempt is NOT actionable
ok("exempt -> not actionable", !isActionableRentIncrease(at("2025-11-21", { exempt: true })));
// null result is NOT actionable
ok("null result -> not actionable", !isActionableRentIncrease(null));

// --- decideRentIncreaseNudge: actionable + not-yet-nudged -> nudge -----------
{
  const result = at("2025-11-21"); // serve_window, eligible 2026-03-01
  const d = decideRentIncreaseNudge({ result, lastNudgedFor: null });
  ok("fresh serve_window -> nudge", d.nudge === true && d.reason === "due");
  ok("stamps the earliest-effective (anniversary) date", d.stampFor === "2026-03-01");
}

// --- already nudged for THIS cycle -> skip ----------------------------------
{
  const result = at("2025-11-21");
  const d = decideRentIncreaseNudge({ result, lastNudgedFor: "2026-03-01" });
  ok("already nudged this cycle -> skip", d.nudge === false && d.reason === "already_nudged");
}

// --- the stamp is STABLE across serve_window -> serve_late -> overdue --------
// All three derive from the same 2026-03-01 anniversary, so one stamp suppresses
// the whole cycle even though the realistic effective date slips daily.
{
  const win = at("2025-11-21"); // serve_window
  const late = at("2025-12-31"); // serve_late, effective slips to today+90
  const over = at("2026-05-01"); // overdue, effective slips to today+90
  ok(
    "serve_window/serve_late/overdue share the anniversary stamp",
    decideRentIncreaseNudge({ result: win, lastNudgedFor: null }).stampFor === "2026-03-01" &&
      decideRentIncreaseNudge({ result: late, lastNudgedFor: null }).stampFor === "2026-03-01" &&
      decideRentIncreaseNudge({ result: over, lastNudgedFor: null }).stampFor === "2026-03-01",
  );
  ok(
    "the 2026-03-01 stamp suppresses re-nudge in serve_late",
    decideRentIncreaseNudge({ result: late, lastNudgedFor: "2026-03-01" }).nudge === false,
  );
  ok(
    "the 2026-03-01 stamp suppresses re-nudge in overdue",
    decideRentIncreaseNudge({ result: over, lastNudgedFor: "2026-03-01" }).nudge === false,
  );
}

// --- recording an increase rolls the anniversary -> the NEXT cycle re-arms ---
{
  // An increase recorded 2026-03-01 → next eligible 2027-03-01. A year later
  // we're back in the serve window, the stale stamp no longer matches.
  const nextCycle = at("2026-11-21", { lastIncreaseDate: "2026-03-01" });
  const d = decideRentIncreaseNudge({ result: nextCycle, lastNudgedFor: "2026-03-01" });
  ok("next cycle re-arms after increase recorded", d.nudge === true && d.stampFor === "2027-03-01");
}

// --- force bypasses the already-nudged gate (test affordance) ----------------
{
  const result = at("2025-11-21");
  const d = decideRentIncreaseNudge({ result, lastNudgedFor: "2026-03-01", force: true });
  ok("force -> nudge even when already stamped", d.nudge === true);
}

// --- non-actionable never nudges, even forced -------------------------------
{
  const scheduled = at("2025-06-01"); // scheduled
  ok(
    "scheduled -> no nudge even forced",
    decideRentIncreaseNudge({ result: scheduled, lastNudgedFor: null, force: true }).nudge === false,
  );
  const exempt = at("2025-11-21", { exempt: true });
  ok(
    "exempt -> no nudge even forced",
    decideRentIncreaseNudge({ result: exempt, lastNudgedFor: null, force: true }).nudge === false,
  );
}

// --- urgency ordering: overdue before serve_late before serve_window --------
ok(
  "urgency: overdue < serve_late < serve_window",
  RENT_INCREASE_URGENCY.overdue < RENT_INCREASE_URGENCY.serve_late &&
    RENT_INCREASE_URGENCY.serve_late < RENT_INCREASE_URGENCY.serve_window,
);

// --- guideline_missing: actionable but no computable amount -> skip + no stamp
// (Codex P2: the cron must not send a placeholder "the new amount" or stamp the
// cycle, so a later guideline publish still re-nudges it).
{
  const missing = deriveRentIncrease(
    { startDate: "2025-10-20", currentRentCents: 200000, exempt: false, guideline: () => null },
    "2026-07-12",
  );
  ok("guideline_missing: result is actionable (serve_window)", isActionableRentIncrease(missing));
  ok("guideline_missing: newRentCents is null", missing?.newRentCents == null);
  const d = decideRentIncreaseNudge({ result: missing, lastNudgedFor: null, force: true });
  ok("guideline_missing -> no nudge even forced", d.nudge === false);
  ok("guideline_missing -> reason guideline_missing", d.reason === "guideline_missing");
  ok("guideline_missing -> nothing stamped", d.stampFor === null);
}

console.log(
  `\ntest-rent-increase-sweep: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
