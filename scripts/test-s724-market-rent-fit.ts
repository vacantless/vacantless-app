// scripts/test-s724-market-rent-fit.ts (V251-05). Run: tsx scripts/test-s724-market-rent-fit.ts
import { benchmarkClassForUnitType, suggestRentRange } from "@/lib/market-rent";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) pass++; else { fail++; console.error("FAIL", n, JSON.stringify(g ?? "")); } }
ok("condo -> condo", benchmarkClassForUnitType("condo").unitClass === "condo");
ok("apartment covered", benchmarkClassForUnitType("apartment").covers === true);
ok("townhouse not covered", benchmarkClassForUnitType("townhouse").covers === false);
ok("house not covered", benchmarkClassForUnitType("house").covers === false);
ok("unset covered", benchmarkClassForUnitType(null).covers === true);
const bench = [{ source: "CMHC", period: "2025 (Oct survey)", unit_class: "condo", beds: 2, geography_label: "Toronto CMA", avg_rent_cents: 203400, country: "CA", city: "toronto" }] as never;
const own = { sampleSize: 0, leasedSampleSize: 0, activeListingSampleSize: 0, medianAskingCents: null, medianDaysOnMarket: null };
const town = suggestRentRange({ subject: { city: "Toronto", beds: 2, unitClass: "purpose_built", benchmarkCovers: false, unitTypeLabel: "townhouse" }, benchmarks: bench, own });
ok("townhouse low confidence", town?.confidence === "low", town);
ok("townhouse says broad context", !!town?.basis[0]?.includes("not a townhouse"), town?.basis);
const condo = suggestRentRange({ subject: { city: "Toronto", beds: 2, unitClass: "condo" }, benchmarks: bench, own });
ok("condo keeps medium", condo?.confidence === "medium", condo);
ok("condo no caveat", !condo?.basis.some((b) => b.includes("broad market")), condo?.basis);
console.log(`s724-market-rent-fit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
