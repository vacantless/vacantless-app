// Unit tests for rental delete/archive guard logic.
// Run: npx tsx scripts/test-property-archive.ts

import { hardDeletable } from "../lib/property-archive";

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

ok("bare draft is hard deletable", hardDeletable("draft", 0, 0, 0));
ok("bare off-market is hard deletable", hardDeletable("off_market", 0, 0, 0));
ok("available is never hard deletable", !hardDeletable("available", 0, 0, 0));
ok("paused is never hard deletable", !hardDeletable("paused", 0, 0, 0));
ok("leased is never hard deletable", !hardDeletable("leased", 0, 0, 0));
ok("draft with a lead is not hard deletable", !hardDeletable("draft", 1, 0, 0));
ok(
  "draft with a tenancy is not hard deletable",
  !hardDeletable("draft", 0, 1, 0),
);
ok(
  "draft with a listing post is not hard deletable",
  !hardDeletable("draft", 0, 0, 1),
);
ok(
  "off-market with any history is not hard deletable",
  !hardDeletable("off_market", 1, 1, 1),
);

console.log(`property-archive: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
