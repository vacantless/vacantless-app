// S841a: Today logs where its time goes (WORKFLOW 418). Logs only; removed
// once read, and this test then flips to assert the marks are gone.
// Run: npx tsx scripts/test-s841a-today-timing.ts
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const page = readFileSync("app/dashboard/page.tsx", "utf8");
ok("timing tag is logged", page.includes("[s841-today-timing]"));
for (const m of ["org", "agent", "batch", "answered", "week", "stages", "rentadj", "viewtimes", "lastweek", "counts", "tiles", "coverage", "emails", "phone", "end"]) {
  ok(`mark ${m}`, page.includes(`timingMark("${m}")`));
}
ok("the log names no renter", !/console\.log\([^)]*(email|name)/.test(page));

console.log(`s841a today timing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
