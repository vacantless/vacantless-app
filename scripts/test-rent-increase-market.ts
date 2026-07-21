// Unit tests for S545 rent-increase <-> market-rent join helper.
// Run: npx tsx scripts/test-rent-increase-market.ts
import { deriveRentIncreaseMarketContext } from "../lib/rent-increase-market";
import type { RentIncrease } from "../lib/rent-increase";
import type { MarketRentSuggestion } from "../lib/market-rent";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`    got:  ${JSON.stringify(got)}`);
    console.error(`    want: ${JSON.stringify(want)}`);
  }
}

function ri(overrides: Partial<RentIncrease> = {}): RentIncrease {
  return {
    status: "serve_window",
    exempt: false,
    earliestEffectiveDate: "2026-12-01",
    effectiveDate: "2026-12-01",
    serveByDate: "2026-09-02",
    daysUntilEligible: 100,
    guidelinePercent: 2.1,
    currentRentCents: 150000,
    newRentCents: 153150,
    increaseCents: 3150,
    note: "x",
    ...overrides,
  };
}
function sug(overrides: Partial<MarketRentSuggestion> = {}): MarketRentSuggestion {
  return {
    lowCents: 170000,
    midCents: 185000,
    highCents: 200000,
    confidence: "medium",
    anchor: null,
    basis: ["CMHC 2025 (Oct survey), purpose-built 2-bed, Windsor CMA: $1,850"],
    ...overrides,
  };
}

// --- honest-null --------------------------------------------------------------
ok("null when no rent increase", deriveRentIncreaseMarketContext({ rentIncrease: null, suggestion: sug() }) === null);
ok("null when no suggestion", deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: null }) === null);
ok(
  "null when suggestion mid is not positive",
  deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: sug({ midCents: 0 }) }) === null,
);

// --- below market (the headline insight) -------------------------------------
{
  const ctx = deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: sug() });
  ok("below: context present", ctx !== null);
  eq("below: compares the capped new rent", ctx?.comparedRentCents, 153150);
  ok("below: comparedIsNewRent true", ctx?.comparedIsNewRent === true);
  eq("below: gap to mid in cents", ctx?.gapToMidCents, 185000 - 153150);
  eq("below: gap percent rounded to 0.1", ctx?.gapToMidPercent, 17.2);
  ok("below: position is below", ctx?.position === "below");
  ok("below: note mentions turnover or AGI", /turnover|AGI/.test(ctx?.note ?? ""));
  ok("below: note has no em dash", !(ctx?.note ?? "").includes("—"));
}

// --- at market (within +/-3% band) -------------------------------------------
{
  // capped new rent 153150 vs mid 155000 -> ~1.2% under -> "at"
  const ctx = deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: sug({ midCents: 155000, lowCents: 148000, highCents: 162000 }) });
  ok("at: position is at", ctx?.position === "at");
  ok("at: note reads as near market", /about at market/.test(ctx?.note ?? ""));
}

// --- above market ------------------------------------------------------------
{
  const ctx = deriveRentIncreaseMarketContext({ rentIncrease: ri({ currentRentCents: 210000, newRentCents: 214410 }), suggestion: sug() });
  ok("above: position is above", ctx?.position === "above");
  ok("above: gap is negative", (ctx?.gapToMidCents ?? 0) < 0);
  ok("above: note says already above", /above the market midpoint/.test(ctx?.note ?? ""));
}

// --- exempt: compares current rent, market-as-reference framing --------------
{
  const ctx = deriveRentIncreaseMarketContext({
    rentIncrease: ri({ exempt: true, status: "exempt", guidelinePercent: null, newRentCents: null, increaseCents: null }),
    suggestion: sug(),
  });
  ok("exempt: context present", ctx !== null);
  ok("exempt: comparedIsNewRent false", ctx?.comparedIsNewRent === false);
  eq("exempt: compares current rent", ctx?.comparedRentCents, 150000);
  ok("exempt: flagged exempt", ctx?.exempt === true);
  ok("exempt: note mentions no cap / exempt", /exempt from the guideline cap/.test(ctx?.note ?? ""));
}

// --- guideline not published yet: newRentCents null -> compares current rent --
{
  const ctx = deriveRentIncreaseMarketContext({
    rentIncrease: ri({ guidelinePercent: null, newRentCents: null, increaseCents: null }),
    suggestion: sug(),
  });
  ok("no-guideline: comparedIsNewRent false", ctx?.comparedIsNewRent === false);
  eq("no-guideline: compares current rent", ctx?.comparedRentCents, 150000);
}

// --- low confidence caveat ----------------------------------------------------
{
  const ctx = deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: sug({ confidence: "low" }) });
  ok("low confidence surfaces a rough-floor caveat", /rough floor/.test(ctx?.note ?? ""));
}

// --- determinism --------------------------------------------------------------
{
  const a = deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: sug() });
  const b = deriveRentIncreaseMarketContext({ rentIncrease: ri(), suggestion: sug() });
  eq("deterministic", a, b);
}

console.log(`rent-increase-market: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
