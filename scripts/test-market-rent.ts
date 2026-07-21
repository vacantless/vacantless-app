// Unit tests for S544 market-rent benchmark + suggestion helpers.
// Run: npx tsx scripts/test-market-rent.ts
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketRentPanel } from "../app/dashboard/properties/[id]/market-rent-panel";
import {
  benchmarksFor,
  cityFromBenchmarkAddress,
  normalizeBenchmarkCity,
  type RentBenchmarkRow,
} from "../lib/rent-benchmarks";
import {
  ownComps,
  suggestRentRange,
  type LeasedOutcomeComp,
  type OwnCompsResult,
} from "../lib/market-rent";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
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

function leased(
  rent: number,
  days: number | null = 10,
  city = "Windsor",
  beds = 2,
): LeasedOutcomeComp {
  return {
    asking_rent_cents: rent,
    days_on_market: days,
    city,
    beds,
    leased_at: "2026-07-01T00:00:00Z",
  };
}

function broadBenchmark(overrides: Partial<RentBenchmarkRow> = {}): RentBenchmarkRow {
  return {
    country: "CA",
    geography: "sample_region",
    geography_label: "Sample Region",
    match_cities: ["sample"],
    beds: 2,
    avg_rent_cents: 200000,
    unit_class: "all",
    source: "PUBLIC",
    report: "Sample Report",
    period: "2024",
    ...overrides,
  };
}

// --- seed loader ------------------------------------------------------------
ok(
  "city normalization trims, lowercases, strips periods",
  normalizeBenchmarkCity("  St. Catharines ") === "st catharines",
);
ok(
  "city normalization is diacritic-insensitive",
  normalizeBenchmarkCity("Montréal") === "montreal",
);
ok(
  "city derived from comma address",
  cityFromBenchmarkAddress("50 Glenrose Avenue, Windsor, ON N9A 1A1") === "Windsor",
);
{
  const rows = benchmarksFor({ city: "Windsor", beds: 2 });
  ok("benchmark hit finds Windsor 2-bed", rows.length === 1);
  ok("benchmark hit uses seed amount", rows[0]?.avg_rent_cents === 145400);
  ok("benchmark hit is country-aware miss", benchmarksFor({ country: "US", city: "Windsor", beds: 2 }).length === 0);
}
{
  const rows = benchmarksFor({ city: "Toronto", beds: 2 });
  ok("multiple Toronto 2-bed benchmarks load", rows.length === 2);
  ok("benchmark rows return most-recent period first", rows[0]?.period === "2026-Q1");
}
ok("benchmark miss returns empty array", benchmarksFor({ city: "Nowhere", beds: 1 }).length === 0);

// --- own comps --------------------------------------------------------------
{
  const own = ownComps({ city: "Windsor", beds: 2 }, [leased(140000), leased(160000)], []);
  ok("own comps below MIN_SAMPLE report null asking median", own.medianAskingCents === null);
  ok("own comps below MIN_SAMPLE report null DOM median", own.medianDaysOnMarket === null);
}
{
  const own = ownComps(
    { city: "Windsor", beds: 2 },
    [leased(140000, 8), leased(160000, 12), leased(180000, 16)],
    [],
  );
  ok("own comps at MIN_SAMPLE report asking median", own.medianAskingCents === 160000);
  ok("own comps at MIN_SAMPLE report DOM median", own.medianDaysOnMarket === 12);
}
{
  const own = ownComps(
    { city: "Windsor", beds: 2 },
    [leased(140000, 8), leased(180000, 16), leased(999000, 4, "Toronto")],
    [
      { rent_cents: 160000, city: "Windsor", beds: 2, status: "available" },
      { rent_cents: 170000, address: "20 Sample Road, Windsor, ON", beds: 2, status: "available" },
      { rent_cents: 120000, city: "Windsor", beds: 1, status: "available" },
      { rent_cents: 190000, city: "Windsor", beds: 2, status: "leased" },
    ],
  );
  ok("own comps above MIN_SAMPLE blend leases and active listings", own.sampleSize === 4);
  ok("own comps exact-match beds/city only", own.medianAskingCents === 165000);
  ok("own comps DOM median stays null when leased DOM sample below MIN_SAMPLE", own.medianDaysOnMarket === null);
}

// --- range suggestions ------------------------------------------------------
const emptyOwn: OwnCompsResult = {
  sampleSize: 0,
  leasedSampleSize: 0,
  activeListingSampleSize: 0,
  medianAskingCents: null,
  medianDaysOnMarket: null,
};

{
  const toronto = suggestRentRange({
    subject: { city: "Toronto", beds: 2 },
    benchmarks: benchmarksFor({ city: "Toronto", beds: 2 }),
    own: emptyOwn,
  });
  ok("purpose-built anchor preferred over condo for small-landlord mid", toronto?.midCents === 203400);
  ok("condo benchmark still appears as extra basis", toronto?.basis.some((line) => line.includes("TRREB 2026-Q1")) === true);
  ok("anchor-only confidence is medium", toronto?.confidence === "medium");
}
{
  const own = ownComps(
    { city: "Windsor", beds: 2 },
    [leased(160000, 9), leased(165000, 11), leased(170000, 13)],
    [],
  );
  const blended = suggestRentRange({
    subject: { city: "Windsor", beds: 2 },
    benchmarks: benchmarksFor({ city: "Windsor", beds: 2 }),
    own,
  });
  ok("blend shifts mid toward own median", blended?.midCents === 155200);
  ok("high confidence requires exact anchor plus own sample", blended?.confidence === "high");
  ok("range is ordered", !!blended && blended.lowCents <= blended.midCents && blended.midCents <= blended.highCents);
}
{
  const own = ownComps(
    { city: "Nowhere", beds: 1 },
    [leased(160000, 9, "Nowhere", 1), leased(165000, 11, "Nowhere", 1), leased(170000, 13, "Nowhere", 1)],
    [],
  );
  const ownOnly = suggestRentRange({
    subject: { city: "Nowhere", beds: 1 },
    benchmarks: benchmarksFor({ city: "Nowhere", beds: 1 }),
    own,
  });
  ok("benchmark miss considers own data only", ownOnly?.midCents === 165000);
  ok("own-only confidence is medium", ownOnly?.confidence === "medium");
  ok("own-only result has no anchor", ownOnly?.anchor === null);
}
{
  const low = suggestRentRange({
    subject: { city: "Sample", beds: 2 },
    benchmarks: [broadBenchmark()],
    own: emptyOwn,
  });
  ok("broader all-rental anchor only is low confidence", low?.confidence === "low");
}
{
  const none = suggestRentRange({
    subject: { city: "Windsor", beds: 1 },
    benchmarks: [],
    own: emptyOwn,
  });
  ok("null result when no data", none === null);
}
{
  const rows = benchmarksFor({ city: "Toronto", beds: 2 });
  const suggestion = suggestRentRange({
    subject: { city: "Toronto", beds: 2 },
    benchmarks: rows,
    own: emptyOwn,
  });
  ok("multiple benchmarks surface as separate basis lines", suggestion?.basis.length === 2);
  const again = suggestRentRange({
    subject: { city: "Toronto", beds: 2 },
    benchmarks: rows,
    own: emptyOwn,
  });
  eq("suggestions are deterministic", suggestion, again);
}

// --- panel render -----------------------------------------------------------
{
  const html = renderToStaticMarkup(
    React.createElement(MarketRentPanel, { suggestion: null, city: "Windsor" }),
  );
  ok("empty panel renders honest empty state", html.includes("Not enough local data yet"));
  ok("empty panel does not render zero dollars", !html.includes("$0"));
}
{
  const suggestion = suggestRentRange({
    subject: { city: "Windsor", beds: 2 },
    benchmarks: benchmarksFor({ city: "Windsor", beds: 2 }),
    own: emptyOwn,
  });
  const html = renderToStaticMarkup(
    React.createElement(MarketRentPanel, { suggestion, city: "Windsor" }),
  );
  ok("panel renders the range", html.includes("$1,338") && html.includes("$1,570"));
  ok("panel renders confidence chip", html.includes("medium confidence"));
  ok("panel renders provenance", html.includes("CMHC 2025 (Oct survey)"));
}

console.log(`market-rent: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
