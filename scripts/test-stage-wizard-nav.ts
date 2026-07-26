// Pure tests for the S588 guided-wizard property-param threading.
// Run: npx tsx scripts/test-stage-wizard-nav.ts
import { withPropertyParam } from "../lib/stage-wizard-nav";

let passed = 0;
let failed = 0;

function eq(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
    console.error(`    expected: ${String(expected)}`);
    console.error(`    actual:   ${String(actual)}`);
  }
}

eq(
  "null id -> unchanged",
  withPropertyParam("/dashboard/add-details", null),
  "/dashboard/add-details",
);
eq(
  "undefined id -> unchanged",
  withPropertyParam("/dashboard/add-details", undefined),
  "/dashboard/add-details",
);
eq(
  "blank id -> unchanged",
  withPropertyParam("/dashboard/add-details", "   "),
  "/dashboard/add-details",
);
eq(
  "id -> appended with ?",
  withPropertyParam("/dashboard/send-live", "abc"),
  "/dashboard/send-live?property=abc",
);
eq(
  "existing query -> appended with &",
  withPropertyParam("/dashboard/settings?tab=distribution", "abc"),
  "/dashboard/settings?tab=distribution&property=abc",
);
eq(
  "hash preserved, param before hash",
  withPropertyParam("/dashboard/properties/x#distribute", "abc"),
  "/dashboard/properties/x?property=abc#distribute",
);
eq(
  "existing query + hash",
  withPropertyParam("/p?a=1#h", "abc"),
  "/p?a=1&property=abc#h",
);
eq(
  "id is url-encoded",
  withPropertyParam("/dashboard/send-live", "a b/c"),
  "/dashboard/send-live?property=a%20b%2Fc",
);

console.log(`\nstage-wizard-nav: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
