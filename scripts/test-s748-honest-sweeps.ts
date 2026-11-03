// S748: sweeps that answer 200 { ok: false } count as failures, slow sweeps
// are flagged, two failures in a row email at once, every sweep has the 60 s
// limit, and page crashes are recorded and reach the health email.
// Run: npx tsx scripts/test-s748-honest-sweeps.ts
import { readFileSync, readdirSync, existsSync } from "node:fs";
import {
  SLOW_SWEEP_MS,
  failedPath,
  repeatFailures,
  summarizeSweeps,
  sweepDetails,
  sweepFailed,
} from "../lib/cron-sweeps";
import { appErrorLines, cleanAppError } from "../lib/app-errors";
import { buildHealthDigest, type HealthInput } from "../lib/health-digest";

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

// 1. what counts as a failure
ok("500 fails", sweepFailed({ path: "/api/cron/a", status: 500, ms: 10 }));
ok("no answer fails", sweepFailed({ path: "/api/cron/a", status: null, ms: 10, error: "TimeoutError" }));
ok("200 ok:false fails", sweepFailed({ path: "/api/cron/a", status: 200, ms: 10, bodyOk: false }));
ok("200 ok:true passes", !sweepFailed({ path: "/api/cron/a", status: 200, ms: 10, bodyOk: true }));
ok("200 with no ok field passes", !sweepFailed({ path: "/api/cron/a", status: 200, ms: 10 }));
ok("disabled flag (ok:true) passes", !sweepFailed({ path: "/api/cron/a", status: 200, ms: 10, bodyOk: true, reason: "disabled" }));

const s = summarizeSweeps([
  { path: "/api/cron/a", status: 200, ms: 100, bodyOk: true },
  { path: "/api/cron/b", status: 200, ms: 100, bodyOk: false, reason: "query_error:boom" },
  { path: "/api/cron/c", status: 503, ms: 100 },
  { path: "/api/cron/d", status: null, ms: 50_000, error: "TimeoutError" },
  { path: "/api/cron/e", status: 200, ms: SLOW_SWEEP_MS + 1, bodyOk: true },
]);
ok("ran 5", s.ran === 5);
ok("3 failed", s.failed.length === 3 && s.succeeded === 2, s);
ok("not_ok label", s.failed.includes("/api/cron/b:not_ok"), s.failed);
ok("status label", s.failed.includes("/api/cron/c:503"), s.failed);
ok("timeout label", s.failed.includes("/api/cron/d:TimeoutError"), s.failed);
ok("slow list", JSON.stringify(s.slow) === JSON.stringify(["/api/cron/d", "/api/cron/e"]), s.slow);

const d = sweepDetails([
  { path: "/api/cron/b", status: 200, ms: 120, bodyOk: false, reason: "query_error:boom" },
  { path: "/api/cron/a", status: 200, ms: 80, bodyOk: true, sent: 3 },
]);
ok("details keep ms", d.b.ms === 120 && d.a.ms === 80, d);
ok("details mark not ok", d.b.ok === false && d.a.ok === undefined, d);
ok("details keep reason", d.b.reason === "query_error:boom", d);

// 2. two in a row
ok("failedPath", failedPath("/api/cron/x:500") === "/api/cron/x" && failedPath("/api/cron/y") === "/api/cron/y");
ok(
  "repeat = in both runs",
  JSON.stringify(repeatFailures(["/api/cron/a:500", "/api/cron/b:not_ok"], ["/api/cron/b:500", "/api/cron/c:503"])) ===
    JSON.stringify(["/api/cron/b"]),
);
ok("no previous run, no alert", repeatFailures(["/api/cron/a:500"], null).length === 0);
ok("no current failure, no alert", repeatFailures([], ["/api/cron/a:500"]).length === 0);

// 3. the route wiring
const route = readFileSync("app/api/cron/sweep-all/route.ts", "utf8");
ok("sweep-all reads body ok", /bodyOk = body\.ok/.test(route));
ok("sweep-all reads body error", /body\.error/.test(route));
ok("sweep-all alerts on repeats", /alertRepeatFailures\(/.test(route) && /repeatFailures\(/.test(route));
ok("alert claims once a day per sweep", /sweep-alert:\$\{name\}/.test(route) && /platform_digest_runs/.test(route));
ok("alert reads the run before inserting", route.indexOf('.select("failed")') < route.indexOf('from("sweep_runs").insert'));

// 4. every sweep route declares the 60 s limit
const missing = readdirSync("app/api/cron").filter((dir) => {
  const f = `app/api/cron/${dir}/route.ts`;
  return existsSync(f) && !/export const maxDuration = \d+/.test(readFileSync(f, "utf8"));
});
ok("every cron route has maxDuration", missing.length === 0, missing);

// 5. page crashes
ok("clean drops the query string", cleanAppError({ path: "/r/abc?p=secret#x", message: "boom" })?.path === "/r/abc");
ok("clean caps message", (cleanAppError({ path: "/", message: "x".repeat(900) })?.message ?? "").length === 300);
ok("clean rejects empty", cleanAppError({}) === null && cleanAppError(null) === null && cleanAppError("x") === null);
ok("clean kind", cleanAppError({ path: "/", kind: "global" })?.kind === "global" && cleanAppError({ path: "/", kind: "evil" })?.kind === "page");
ok("clean strips control chars", cleanAppError({ path: "/", message: "a\u0000b\nc" })?.message === "a b c");
const lines = appErrorLines([
  { path: "/r/11111111-2222-3333-4444-555555555555" },
  { path: "/r/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  { path: "/dashboard" },
]);
ok("crash lines group ids", lines[0] === "/r/<id>: 2 crashes." && lines[1] === "/dashboard: 1 crash.", lines);
ok("error page posts", /report-error/.test(readFileSync("app/error.tsx", "utf8")));
ok("global error page posts", /report-error/.test(readFileSync("app/global-error.tsx", "utf8")));
const rep = readFileSync("app/api/report-error/route.ts", "utf8");
ok("report route is capped", /allowHit\(/.test(rep) && /APP_ERROR_LIMIT/.test(rep));
ok("migration 0269 exists", existsSync("supabase/migrations/0269_app_errors.sql"));

// 6. the health email
const base: HealthInput = {
  now: new Date("2026-11-04T13:00:00Z"),
  sweeps: [
    {
      ran_at: "2026-11-04T12:45:00Z",
      ok: false,
      ran: 32,
      failed: ["/api/cron/nurture:not_ok"],
      details: { "slow-sweeps": { status: null, reason: "/api/cron/distribution-freshness" } },
    },
  ],
  lastSweepAt: "2026-11-04T12:45:00Z",
  emails: { checked: true, problems: [] },
  portal: [],
  parserNotes: [],
  robot: [],
  signIns: [],
  appErrors: [{ path: "/dashboard" }],
};
const mail = buildHealthDigest(base);
ok("email names the not-ok sweep", mail.body.includes("nurture failed in 1 of 1 runs"), mail.body);
ok("email names the slow sweep", mail.body.includes("Close to the time limit (40 s or more): distribution-freshness"), mail.body);
ok("email lists crashes", mail.body.includes("PAGE CRASHES") && mail.body.includes("/dashboard: 1 crash."), mail.body);
ok("email says crashes are checked", mail.body.includes("page crashes. Not checked here: errors inside API calls"), mail.body);
const noRead = buildHealthDigest({ ...base, appErrors: null });
ok("unread crash log keeps old wording", noRead.body.includes("Not checked here: app errors"));

console.log(`\ns748 honest sweeps: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
