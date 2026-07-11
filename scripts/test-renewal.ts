// Unit tests for the renewal check-in engine (autopilot Slice A, S460).
// Run: npx tsx scripts/test-renewal.ts
import {
  deriveRenewalCheckin,
  branchForIntent,
  isRenewalIntent,
  CHECKIN_LEAD_DAYS,
  RENEWAL_INTENTS,
  type RenewalCheckinInput,
} from "../lib/renewal";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function inp(over: Partial<RenewalCheckinInput> = {}): RenewalCheckinInput {
  return { startDate: "2025-03-01", endDate: null, intent: null, ...over };
}

// --- constants + guards -----------------------------------------------------
ok("lead days is 90", CHECKIN_LEAD_DAYS === 90);
ok("three intents", RENEWAL_INTENTS.length === 3);
ok("isRenewalIntent accepts staying", isRenewalIntent("staying"));
ok("isRenewalIntent accepts leaving", isRenewalIntent("leaving"));
ok("isRenewalIntent accepts unsure", isRenewalIntent("unsure"));
ok("isRenewalIntent rejects junk", !isRenewalIntent("maybe"));
ok("isRenewalIntent rejects null", !isRenewalIntent(null));

// --- branch mapping ---------------------------------------------------------
ok("staying -> proceed", branchForIntent("staying") === "proceed_increase");
ok("unsure -> proceed", branchForIntent("unsure") === "proceed_increase");
ok("leaving -> turnover", branchForIntent("leaving") === "handoff_turnover");
ok("null -> no branch", branchForIntent(null) === null);
ok("undefined -> no branch", branchForIntent(undefined) === null);

// --- anchor: no end_date -> first-year completion (start + 12mo) -------------
{
  const r = deriveRenewalCheckin(inp(), "2025-06-01")!;
  ok("completion = start + 12mo", r.completionDate === "2026-03-01");
  ok("checkin opens = completion - 90d", r.checkinOpensDate === "2025-12-01");
}

// --- anchor: fixed-term end_date wins over the anniversary -------------------
{
  const r = deriveRenewalCheckin(inp({ endDate: "2026-02-28" }), "2025-06-01")!;
  ok("completion = end_date", r.completionDate === "2026-02-28");
  ok("checkin opens = end - 90d", r.checkinOpensDate === "2025-11-30");
}

// --- status: not_ready before the window opens ------------------------------
{
  // window opens 2025-12-01; a day before is not_ready.
  const r = deriveRenewalCheckin(inp(), "2025-11-30")!;
  ok("before window -> not_ready", r.status === "not_ready");
  ok("no branch while unanswered", r.branch === null);
}

// --- status: due inside the window ------------------------------------------
{
  const open = deriveRenewalCheckin(inp(), "2025-12-01")!;
  ok("window-open day -> due", open.status === "due");
  const mid = deriveRenewalCheckin(inp(), "2026-01-15")!;
  ok("mid window -> due", mid.status === "due");
  const last = deriveRenewalCheckin(inp(), "2026-03-01")!;
  ok("completion day -> still due", last.status === "due");
}

// --- status: passed once completion has gone by with no answer --------------
{
  const r = deriveRenewalCheckin(inp(), "2026-03-02")!;
  ok("day after completion -> passed", r.status === "passed");
  ok("days until completion negative", r.daysUntilCompletion === -1);
}

// --- status: answered overrides the window (any date) -----------------------
{
  const early = deriveRenewalCheckin(inp({ intent: "staying" }), "2025-06-01")!;
  ok("answered before window -> answered", early.status === "answered");
  ok("staying -> proceed branch", early.branch === "proceed_increase");

  const leaving = deriveRenewalCheckin(inp({ intent: "leaving" }), "2026-01-15")!;
  ok("leaving -> answered", leaving.status === "answered");
  ok("leaving -> turnover branch", leaving.branch === "handoff_turnover");
}

// --- lead-day override ------------------------------------------------------
{
  const r = deriveRenewalCheckin(inp({ leadDays: 120 }), "2025-06-01")!;
  ok("120-day lead opens earlier", r.checkinOpensDate === "2025-11-01");
}

// --- days-until math --------------------------------------------------------
{
  const r = deriveRenewalCheckin(inp(), "2026-02-01")!;
  ok("28 days to a Mar-01 completion", r.daysUntilCompletion === 28);
}

// --- unparseable inputs -> null ---------------------------------------------
ok("null start -> null", deriveRenewalCheckin(inp({ startDate: null }), "2025-06-01") === null);
ok("bad today -> null", deriveRenewalCheckin(inp(), "not-a-date") === null);

// --- unparseable end_date falls back to the anniversary (not null) ----------
{
  const r = deriveRenewalCheckin(inp({ endDate: "garbage" }), "2025-06-01")!;
  ok("bad end_date -> anniversary fallback", r.completionDate === "2026-03-01");
}

console.log(`\nrenewal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
