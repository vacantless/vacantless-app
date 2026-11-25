// S841c: a 5-minute cron opens /warm so the server copy the dashboard uses
// stays awake. Run: npx tsx scripts/test-s841c-keep-warm.ts
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

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
const warm = vercel.crons.filter((c) => c.path === "/warm");
ok("one /warm cron", warm.length === 1);
ok("every 5 minutes", warm[0]?.schedule === "*/5 * * * *");
ok("the other crons are kept", vercel.crons.some((c) => c.path === "/api/cron/reminders") && vercel.crons.some((c) => c.path === "/api/cron/distribution-freshness"));

const page = readFileSync("app/warm/page.tsx", "utf8");
ok("page is dynamic (a cached page wakes nothing)", page.includes('export const dynamic = "force-dynamic";'));
ok("page is not indexed", page.includes("index: false"));
// S841f: it now touches the database and the sign-in service, and shows none of it.
ok("page asks the database one tiny question", page.includes('select("id", { count: "exact", head: true }).limit(1)'));
ok("page asks the sign-in service if it is up", page.includes("/auth/v1/health"));
ok("page shows nothing it read", page.includes("return <p>ok</p>;") && (page.match(/return </g) ?? []).length === 1);
ok("robots keeps it out", readFileSync("app/robots.ts", "utf8").includes('"/warm"'));
ok("host redirect skips it", readFileSync("lib/canonical-host.ts", "utf8").includes("if (input.pathname === WARM_PATH) return null;"));

// S841e: boot marks while the cold start is measured (flip to "gone" when read).
ok("warm logs its boot mark", page.includes('bootMark("warm")'));
ok("dashboard logs its boot mark", readFileSync("app/dashboard/layout.tsx", "utf8").includes('bootMark("dashboard")'));

console.log(`s841c keep warm: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
