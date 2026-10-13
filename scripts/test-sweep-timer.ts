// S713e: the database timer runs the same sweeps GitHub does.
// Run: npx tsx scripts/test-sweep-timer.ts
import { readFileSync } from "node:fs";
import { SWEEP_PATHS, summarizeSweeps } from "../lib/cron-sweeps";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

const yml = readFileSync(".github/workflows/reminders.yml", "utf8");
const ymlPaths = Array.from(
  new Set(Array.from(yml.matchAll(/vacantless-app\.vercel\.app(\/api\/cron\/[a-z0-9-]+)/g)).map((m) => m[1])),
).sort();
const listed = [...SWEEP_PATHS].sort();
ok("same sweeps as the GitHub backup", JSON.stringify(ymlPaths) === JSON.stringify(listed), {
  onlyGitHub: ymlPaths.filter((p) => !listed.includes(p as never)),
  onlyHere: listed.filter((p) => !ymlPaths.includes(p)),
});
ok("no duplicates", new Set(SWEEP_PATHS).size === SWEEP_PATHS.length);
ok("does not call itself", !SWEEP_PATHS.includes("/api/cron/sweep-all" as never));
for (const p of SWEEP_PATHS) {
  let exists = true;
  try {
    readFileSync(`app${p}/route.ts`, "utf8");
  } catch {
    exists = false;
  }
  ok(`route exists: ${p}`, exists);
}

const s = summarizeSweeps([
  { path: "/a", status: 200, ms: 1 },
  { path: "/b", status: 500, ms: 1 },
  { path: "/c", status: null, ms: 1, error: "TimeoutError" },
]);
ok("summary counts", s.ran === 3 && s.succeeded === 1 && s.failed.length === 2);
ok("summary names the timeout", s.failed.includes("/c:TimeoutError"));

const route = readFileSync("app/api/cron/sweep-all/route.ts", "utf8");
ok("route refuses without a password", /status: 401/.test(route));
ok("route asks the database to check its secret", /rpc\("sweep_trigger_secret_matches"/.test(route));
ok("route calls each sweep with CRON_SECRET", /authorization: `Bearer \$\{cronSecret\}`/.test(route));
ok("route caps each sweep", /AbortSignal\.timeout\(PER_SWEEP_TIMEOUT_MS\)/.test(route));

const sql = readFileSync("supabase/migrations/0245_sweep_timer_in_database.sql", "utf8");
ok("timer every 15 minutes", /'\*\/15 \* \* \* \*'/.test(sql));
ok("timer calls sweep-all", /\/api\/cron\/sweep-all/.test(sql));
ok("secret generated in the vault", /vault\.create_secret\(/.test(sql) && /gen_random_bytes\(32\)/.test(sql));
ok("check is service-role only", /revoke all on function public\.sweep_trigger_secret_matches\(text\) from public, anon, authenticated/.test(sql) && /to service_role/.test(sql));
ok("job is re-runnable", /cron\.unschedule\('vacantless-sweeps'\)/.test(sql));

console.log(`sweep timer: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
