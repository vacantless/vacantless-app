// Unit tests for the rent-guideline server lookup merge (S465).
// Run: npx tsx scripts/test-guideline-lookup.ts
import { mergeGuidelineRows } from "../lib/guideline-server";
import { guidelineForYear } from "../lib/rent-increase";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// supabase-js returns numeric as string -> coerce both year and percent.
{
  const m = mergeGuidelineRows([
    { year: 2028, percent: "2.3" },
    { year: "2029", percent: 2.0 },
  ]);
  ok("string percent coerced", m.get(2028) === 2.3);
  ok("string year coerced", m.get(2029) === 2.0);
  ok("only the two valid rows", m.size === 2);
}

// invalid rows are dropped, never poison the map.
{
  const m = mergeGuidelineRows([
    { year: "x", percent: "2" },
    { year: 2030, percent: "nope" },
    { year: 2031, percent: -1 },
  ]);
  ok("bad/negative rows all dropped", m.size === 0);
}

// composed lookup: DB override ?? code constant ?? null (matches loadGuidelineLookup).
{
  const m = mergeGuidelineRows([{ year: 2028, percent: "2.4" }]);
  const lookup = (y: number) => {
    const v = m.get(y);
    return v != null ? v : guidelineForYear(y);
  };
  ok("DB override wins for a future year", lookup(2028) === 2.4);
  ok("falls back to the constant for 2026", lookup(2026) === 2.1);
  ok("null when neither DB nor constant has it", lookup(2035) === null);
}

console.log(`\nguideline-lookup: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
