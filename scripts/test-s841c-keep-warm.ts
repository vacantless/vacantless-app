// S841c added a 5-minute /warm ping; S841e and S841f measured it. The copy it
// kept awake still served the first dashboard load after a quiet spell in
// 2.3 to 3.3 s, with the database answering the ping in 0.2 to 1.2 s, so the
// ping did not fix the slow first load. S841g removed it and the boot marks.
// Run: npx tsx scripts/test-s841c-keep-warm.ts
import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string }[] };
ok("no /warm cron", !vercel.crons.some((c) => c.path === "/warm"));
ok("the other crons are kept", vercel.crons.some((c) => c.path === "/api/cron/reminders") && vercel.crons.some((c) => c.path === "/api/cron/distribution-freshness"));
ok("no /warm page", !existsSync("app/warm/page.tsx"));
ok("no boot marks", !existsSync("lib/boot-mark.ts") && !readFileSync("app/dashboard/layout.tsx", "utf8").includes("bootMark"));
ok("robots back to before", !readFileSync("app/robots.ts", "utf8").includes("/warm"));
ok("host redirect back to before", !readFileSync("lib/canonical-host.ts", "utf8").includes("WARM_PATH"));

console.log(`s841c keep warm: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
