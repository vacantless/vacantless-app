// S751 (Fable review, lower list): cron routes take CRON_SECRET only as a bearer
// header. A secret in the query string lands in request logs.
// Run: tsx scripts/test-s751-cron-header-only.ts
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function ok(msg: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const routes = walk("app/api/cron");
ok("found the cron routes", routes.length >= 25);
for (const r of routes) {
  const src = fs.readFileSync(r, "utf8");
  ok(`${r}: no secret read from the URL`, !/searchParams\.get\(\s*["'](secret|cron_secret|key)["']\s*\)/.test(src));
}

console.log(`cron-header-only: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
