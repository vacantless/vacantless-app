// Run with: npx tsx scripts/test-building-key-parity.ts
//
// B4 regression guard for the deferred SQL recompute work: same-spelling
// buildings must stay aligned, while the street-type abbreviation drift remains
// explicit until the SQL function + stored generated column are migrated.

import { readFileSync } from "node:fs";
import { buildingKey } from "../lib/booking";

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`  x ${name}\n     got  ${g}\n     want ${w}`);
  }
}

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function sqlBuildingKey0049(address: string | null | undefined): string {
  const stripped = String(address ?? "")
    .toLowerCase()
    .replace(/[, \t\r\n]*(\b(?:unit|suite|ste|apt|apartment)\b\.?|#)[ \t\r\n]*[a-z0-9-]+/g, "")
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/(^[ \t\r\n,]+)|([ \t\r\n,]+$)/g, "")
    .trim();
  return stripped;
}

const sameSpellingCases = [
  "833 Pillette Rd Unit 22",
  "833 Pillette Rd #27",
  "55 Bloor Ave #1201",
  "12 Main St Apartment 3",
];

for (const address of sameSpellingCases) {
  eq(`same-spelling TS/SQL parity: ${address}`,
    buildingKey(address), sqlBuildingKey0049(address));
}

const abbreviationPairs = [
  ["123 Elm Road", "123 Elm Rd"],
  ["5 King Street", "5 King St"],
  ["9 Cedar Avenue Unit 2", "9 Cedar Ave Unit 2"],
];

for (const [longForm, shortForm] of abbreviationPairs) {
  eq(`TS folds street type pair: ${longForm} / ${shortForm}`,
    buildingKey(longForm), buildingKey(shortForm));
  ok(`SQL 0049 divergence remains explicit: ${longForm} / ${shortForm}`,
    sqlBuildingKey0049(longForm) !== sqlBuildingKey0049(shortForm));
}

for (const address of [...sameSpellingCases, ...abbreviationPairs.flat()]) {
  const tsKey = buildingKey(address);
  const sqlKey = sqlBuildingKey0049(address);
  eq(`TS idempotent: ${address}`, buildingKey(tsKey), tsKey);
  eq(`SQL idempotent: ${address}`, sqlBuildingKey0049(sqlKey), sqlKey);
}

const bookingSource = readFileSync("lib/booking.ts", "utf8");
const sqlSource = readFileSync("supabase/migrations/0049_building_policy_override.sql", "utf8");
const sqlFunctionBody =
  /create or replace function public\.building_key\(p_address text\)[\s\S]*?\$\$;/i.exec(sqlSource)?.[0] ?? "";
ok("booking source documents the deferred TS/SQL abbreviation drift",
  bookingSource.includes("Known drift: SQL public.building_key in 0049"));
ok("0049 SQL still has no street-abbreviation folding in this deferred slice",
  !/\b(?:road|street|avenue|boulevard|crescent)\b/i.test(sqlFunctionBody));

console.log(`
building-key-parity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
