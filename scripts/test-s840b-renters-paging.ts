// S840b (REVIEW-S839 step H, first part): the Renters list shows the first
// rows of each group and a "Show all" link, so Agile's page is not 1 MB.
// Run: npx tsx scripts/test-s840b-renters-paging.ts
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

const q = readFileSync("app/dashboard/leads/triage-queue.tsx", "utf8");
ok("preview size is 20", /export const BUCKET_PREVIEW = 20;/.test(q));
ok("Needs you now is never cut", /bucket !== "needs_you"/.test(q));
ok("rows rendered are the capped list", /\{shown\.map\(/.test(q) && !/\{items\.map\(\(\{ l, t \}\)/.test(q));
ok("Show all names the whole count", q.includes("Show all {items.length}"));
ok("Show all jumps to its group", q.includes("${allHref}#${bucket}") && q.includes("id={bucket}"));
ok("group count stays whole", q.includes("{items.length}\n              </span>"));

const page = readFileSync("app/dashboard/leads/page.tsx", "utf8");
ok("page reads ?all=1", page.includes('showAll={searchParams.all === "1"}'));
ok("Show all keeps the filters", page.includes("allHref={withAll(leadsHref(filter, segment, screen, propertyId))}"));
ok("chip counts still use every renter", /label=\{`All \(\$\{scoped\.length\}\)`\}/.test(page));

const rental = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("rental page timing log is gone (S840d)", !rental.includes("s840-rental-timing") && !rental.includes("timingMark"));

console.log(`s840b renters paging: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
