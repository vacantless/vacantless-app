// S801: only the dead-cookie refresh failure is dropped from the error log.
// Run: npx tsx scripts/test-quiet-dead-token.ts
import { readFileSync } from "node:fs";
import { isDeadRefreshTokenLog, quietDeadRefreshTokenLogs } from "../lib/quiet-dead-token";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const dead = { __isAuthError: true, status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" };
ok("dead-cookie error is recognised", isDeadRefreshTokenLog([dead]));
ok("another auth error stays visible", !isDeadRefreshTokenLog([{ __isAuthError: true, code: "invalid_credentials" }]));
ok("a plain error stays visible", !isDeadRefreshTokenLog([new Error("refresh_token_not_found")]));
ok("a labelled log line stays visible", !isDeadRefreshTokenLog(["[auth]", dead]));
ok("null and strings stay visible", !isDeadRefreshTokenLog([null]) && !isDeadRefreshTokenLog(["x"]) && !isDeadRefreshTokenLog([]));

const seen: unknown[][] = [];
const original = console.error;
console.error = (...a: unknown[]) => { seen.push(a); };
quietDeadRefreshTokenLogs();
quietDeadRefreshTokenLogs(); // second call must not wrap twice
console.error(dead);
console.error("real problem");
console.error = original;
ok("filter drops the dead-cookie line and keeps the rest", seen.length === 1 && seen[0][0] === "real problem");

const mw = readFileSync("lib/supabase/middleware.ts", "utf8");
ok("middleware installs the filter", mw.includes("quietDeadRefreshTokenLogs();"));

console.log(`\nquiet-dead-token: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
