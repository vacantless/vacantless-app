// S712: size estimate when the landlord leaves it blank.
// Run: npx tsx scripts/test-sqft-estimate.ts
import { readFileSync } from "node:fs";
import { estimateSqft } from "../lib/sqft-estimate";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("no beds, no estimate", estimateSqft({ beds: null, sameBuilding: [], sameOrg: [] }) === null);
ok("same building wins", estimateSqft({ beds: 1, sameBuilding: [500, 520], sameOrg: [900] })?.sqft === 510);
ok("same building source", estimateSqft({ beds: 1, sameBuilding: [500], sameOrg: [] })?.source === "building");
ok("org median next", estimateSqft({ beds: 2, sameBuilding: [], sameOrg: [600, 700, 900] })?.sqft === 700);
ok("default 1 bed is 650 (600-699)", estimateSqft({ beds: 1, sameBuilding: [], sameOrg: [] })?.sqft === 650);
ok("default 2 bed is 800 (700+)", estimateSqft({ beds: 2, sameBuilding: [], sameOrg: [] })?.sqft === 800);
ok("default studio", estimateSqft({ beds: 0, sameBuilding: [], sameOrg: [] })?.sqft === 500);
ok("default 5 bed", estimateSqft({ beds: 5, sameBuilding: [], sameOrg: [] })?.sqft === 1400);
ok("rounds to 10", estimateSqft({ beds: 1, sameBuilding: [553], sameOrg: [] })?.sqft === 550);
ok("ignores zero sizes", estimateSqft({ beds: 1, sameBuilding: [0], sameOrg: [] })?.source === "default");

const server = readFileSync("lib/sqft-estimate-server.ts", "utf8");
ok("typed size always wins", server.includes("return { sqft: input.typedSqft, sqft_estimated: false }"));
ok("only real sizes are evidence", server.includes('.eq("sqft_estimated", false)'));
ok("org-scoped", server.includes('.eq("organization_id", input.orgId)'));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("create and update both use the estimate", (actions.match(/\.\.\.sizeToSave,/g) ?? []).length === 2);

console.log(`\nsqft-estimate: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
