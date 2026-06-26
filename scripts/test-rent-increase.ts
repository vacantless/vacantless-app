// Unit tests for the Ontario rent-increase engine (N1 v1, S282).
// Run: npx tsx scripts/test-rent-increase.ts
import {
  deriveRentIncrease,
  guidelineForYear,
  NOTICE_DAYS,
  REMINDER_LEAD_DAYS,
  type RentIncreaseInput,
} from "../lib/rent-increase";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function inp(over: Partial<RentIncreaseInput> = {}): RentIncreaseInput {
  return {
    startDate: "2025-03-01",
    lastIncreaseDate: null,
    currentRentCents: 200000, // $2,000.00
    ...over,
  };
}

// --- guideline table --------------------------------------------------------
ok("2026 guideline is 2.1%", guidelineForYear(2026) === 2.1);
ok("2025 guideline is 2.5%", guidelineForYear(2025) === 2.5);
ok("unknown year -> null", guidelineForYear(2099) === null);

// --- eligible date = start + 12 months when no prior increase ---------------
{
  const r = deriveRentIncrease(inp(), "2025-06-01")!;
  ok("eligible = start + 12mo", r.earliestEffectiveDate === "2026-03-01");
  ok("serve-by = eligible - 90d", r.serveByDate === "2025-12-01");
}

// --- eligible date measured from last increase when present -----------------
{
  const r = deriveRentIncrease(
    inp({ startDate: "2022-01-01", lastIncreaseDate: "2025-05-01" }),
    "2025-06-01",
  )!;
  ok("eligible measured from last increase", r.earliestEffectiveDate === "2026-05-01");
}

// --- status: far out -> scheduled -------------------------------------------
{
  const r = deriveRentIncrease(inp(), "2025-06-01")!; // ~273 days out
  ok("far out -> scheduled", r.status === "scheduled");
  ok("scheduled note mentions serve-by", r.note.includes("2025-12-01"));
}

// --- status: inside reminder window, ≥90 days runway -> serve_window --------
{
  // eligible 2026-03-01; pick a day ~100 days before (within 120, ≥90)
  const r = deriveRentIncrease(inp(), "2025-11-21")!;
  ok("100 days out -> serve_window", r.status === "serve_window");
  ok(
    "serve_window uses earliest effective date",
    r.effectiveDate === "2026-03-01",
  );
}

// --- status: past serve-by but before eligible -> serve_late (date slips) ---
{
  // 60 days before eligible: <90 runway, but eligible not yet reached
  const r = deriveRentIncrease(inp(), "2025-12-31")!;
  ok("60 days out -> serve_late", r.status === "serve_late");
  ok(
    "serve_late pushes effective to today+90",
    r.effectiveDate === "2026-03-31",
  );
  ok("serve_late serve-by is today", r.serveByDate === "2025-12-31");
}

// --- status: eligible date passed -> overdue --------------------------------
{
  const r = deriveRentIncrease(inp(), "2026-05-01")!; // 2 months past eligible
  ok("past eligible -> overdue", r.status === "overdue");
  ok("overdue note flags money on the table", r.note.toLowerCase().includes("leaving money"));
  ok("overdue effective = today + 90", r.effectiveDate === "2026-07-30");
}

// --- amounts: new rent applies the effective-year guideline -----------------
{
  const r = deriveRentIncrease(inp(), "2025-11-21")!; // effective 2026 -> 2.1%
  ok("new rent = current * 1.021", r.newRentCents === Math.round(200000 * 1.021));
  ok("new rent is $2,042.00", r.newRentCents === 204200);
  ok("increase = 4200 cents", r.increaseCents === 4200);
  ok("guideline percent carried", r.guidelinePercent === 2.1);
}

// --- exemption: post-2018 unit, no cap, no amounts --------------------------
{
  const r = deriveRentIncrease(inp({ exempt: true }), "2025-11-21")!;
  ok("exempt -> status exempt", r.status === "exempt");
  ok("exempt -> null guideline", r.guidelinePercent === null);
  ok("exempt -> null new rent", r.newRentCents === null && r.increaseCents === null);
}

// --- guideline not yet published for the effective year ----------------------
{
  // effective 2027 (no entry) -> guideline null but dates still computed
  const r = deriveRentIncrease(
    inp({ startDate: "2026-06-01", lastIncreaseDate: null }),
    "2026-06-15",
  )!;
  ok("future year -> null guideline", r.guidelinePercent === null);
  ok("future year -> null new rent", r.newRentCents === null);
  ok("future year note says not yet published", r.note.includes("not yet published"));
  ok("dates still derived", r.earliestEffectiveDate === "2027-06-01");
}

// --- boundary: exactly REMINDER_LEAD_DAYS and exactly NOTICE_DAYS -----------
{
  // exactly 120 days before eligible -> still serve_window (>=90, <=120 band)
  const r120 = deriveRentIncrease(inp(), "2025-11-01")!; // 2025-11-01 -> 2026-03-01 = 120d
  ok("exactly 120 days out -> serve_window", r120.status === "serve_window" && r120.daysUntilEligible === REMINDER_LEAD_DAYS);
  // exactly 90 days before eligible -> still serve_window (boundary inclusive)
  const r90 = deriveRentIncrease(inp(), "2025-12-01")!; // -> 90 days
  ok("exactly 90 days out -> serve_window", r90.status === "serve_window" && r90.daysUntilEligible === NOTICE_DAYS);
}

// --- persisted last-increase date advances the cycle (S339 column) ----------
{
  // Same tenancy, but a prior increase was recorded on 2025-05-01. The next
  // eligible date is measured from THAT, not the 2025-03-01 start.
  const noLast = deriveRentIncrease(inp({ startDate: "2025-03-01" }), "2025-06-01")!;
  ok("no last-increase -> eligible from start", noLast.earliestEffectiveDate === "2026-03-01");
  const withLast = deriveRentIncrease(
    inp({ startDate: "2025-03-01", lastIncreaseDate: "2025-05-01" }),
    "2025-06-01",
  )!;
  ok("recorded last-increase -> eligible advances ~1yr", withLast.earliestEffectiveDate === "2026-05-01");
  ok("recorded last-increase pushes serve-by too", withLast.serveByDate === "2026-01-31");
}

// --- persisted exemption flag (S339 properties.rent_control_exempt) ----------
{
  // A post-2018 unit inside what would otherwise be the serve window: the stored
  // exemption short-circuits to `exempt` with no amounts, no matter the dates.
  const capped = deriveRentIncrease(inp(), "2025-11-21")!;
  ok("not exempt -> actionable serve_window", capped.status === "serve_window");
  const exempt = deriveRentIncrease(inp({ exempt: true }), "2025-11-21")!;
  ok("stored exempt=true -> status exempt", exempt.status === "exempt");
  ok("stored exempt=true -> no guideline/amounts", exempt.guidelinePercent === null && exempt.newRentCents === null);
}

// --- robustness: bad dates -> null ------------------------------------------
ok("bad today -> null", deriveRentIncrease(inp(), "not-a-date") === null);
ok("bad start -> null", deriveRentIncrease(inp({ startDate: "2025-13-40" }), "2025-06-01") === null);

console.log(
  `\ntest-rent-increase: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
