// S841a logged where Today spends its time (c3f647c); S841b starts the calls
// that waited one after another together, and the timing log is gone.
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
ok("timing log is gone (S841b)", !page.includes("s841-today-timing") && !page.includes("timingMark"));

// Each of these starts before the main batch and is awaited where it is used.
const batchAt = page.indexOf("  const [\n    { data: leads },");
ok("main batch found", batchAt > 0);
for (const name of [
  "weekViewingsEarly",
  "turnoverStagesEarly",
  "openViewingTimesEarly",
  "droppedAdsEarly",
  "renterEmailsEarly",
  "phoneRepliesEarly",
]) {
  const at = page.indexOf(`const ${name} =`);
  ok(`${name} starts before the batch`, at > 0 && at < batchAt);
  ok(`${name} is awaited`, page.includes(`await ${name}`));
}
ok("no second coverage load", (page.match(/loadPostingCoverage\(/g) ?? []).length === 1);
ok("no second stages read", (page.match(/latestStages\(/g) ?? []).length === 1);
ok("no second viewing-times count", (page.match(/countViewingTimes\(/g) ?? []).length === 1);
ok("no second phone-reply read", (page.match(/hasPhoneReplyRenter\(/g) ?? []).length === 1);
ok("renter email reads only when posting is set up", /access\.setup\s*\?\s*Promise\.all\(\[readRenterEmailEvents/.test(page));
ok("dropped ads only when posting is set up", page.includes("if (!access.setup) return null;"));

console.log(`s841a today timing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
