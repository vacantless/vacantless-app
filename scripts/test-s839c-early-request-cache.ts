// S839c: questions that run together (lib/early.ts) and one sign-in check per
// page render (lib/request-cache.ts). Run: npx tsx scripts/test-s839c-early-request-cache.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { early } from "../lib/early";
import { perRequest } from "../lib/request-cache";

async function main() {
  // early() starts a lazy query at once (a Supabase query only runs when awaited).
  let started = 0;
  const lazy = (value: string): PromiseLike<string> => ({
    then: (resolve, reject) => {
      started += 1;
      return Promise.resolve(value).then(resolve, reject);
    },
  });
  const a = early(lazy("a"));
  const b = early(lazy("b"));
  await Promise.resolve();
  assert.equal(started, 2, "both started before either was awaited");
  assert.equal(await a, "a");
  assert.equal(await b, "b");

  // A failure still throws at the await, and is not an unhandled rejection before it.
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on("unhandledRejection", onUnhandled);
  const bad = early(Promise.reject(new Error("boom")));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(unhandled, 0);
  await assert.rejects(async () => { await bad; }, /boom/);
  process.off("unhandledRejection", onUnhandled);

  // perRequest() never changes the answer; outside a server render it calls through.
  let calls = 0;
  const f = perRequest((x: number) => { calls += 1; return x * 2; });
  assert.equal(f(2), 4);
  assert.equal(f(2), 4);
  assert.ok(calls >= 1);

  // Wiring.
  const org = readFileSync("lib/org.ts", "utf8");
  assert.ok(org.includes("export const getCurrentOrg = perRequest(loadCurrentOrg);"));
  assert.ok(org.includes("export const listMyOrgs = perRequest(loadMyOrgs);"));
  assert.ok(!org.includes("auth.getUser()"), "org lookups use the per-render user");
  const server = readFileSync("lib/supabase/server.ts", "utf8");
  assert.ok(server.includes("export const getRequestUser = perRequest("));
  assert.ok(server.includes("supabase.auth.getUser()"), "still a real check with the auth server");
  assert.ok(readFileSync("app/dashboard/layout.tsx", "utf8").includes("await getRequestUser()"));
  for (const [file, least] of [
    ["app/dashboard/page.tsx", 15], // S841b: +5 (Today timing log)
    ["app/dashboard/properties/[id]/page.tsx", 28], // S840: +10 (REVIEW-S839 H block 1)
    ["app/dashboard/tenancies/[id]/page.tsx", 21],
  ] as const) {
    const src = readFileSync(file, "utf8");
    const startedEarly = [...src.matchAll(/const (\w+Early) = early\(/g)].map((m) => m[1]);
    assert.ok(startedEarly.length >= least, `${file}: ${startedEarly.length}`);
    for (const name of startedEarly) {
      assert.equal(src.split(`await ${name};`).length - 1, 1, `${file}: ${name} awaited exactly once`);
    }
  }
  console.log("test-s839c-early-request-cache: ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
