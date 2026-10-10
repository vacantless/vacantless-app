// Run with: npx tsx scripts/test-post-now.ts
// S702s: approving a post asks GitHub to run the posting worker right away.
import { readFileSync } from "node:fs";
import { POST_NOW_EVENT, postNowRequest, triggerPostNow } from "../lib/post-now";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error(`FAIL: ${n}`)));

async function main() {
  const r = postNowRequest("tok", "vacantless/vacantless-worker");
  ok("dispatch url", r.url === "https://api.github.com/repos/vacantless/vacantless-worker/dispatches");
  ok("event name matches workflow", POST_NOW_EVENT === "post-now" && String(r.init.body).includes('"post-now"'));
  ok("bearer token", (r.init.headers as Record<string, string>).Authorization === "Bearer tok");

  let called = 0;
  const fake204 = (async () => { called++; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  ok("dark without a token", (await triggerPostNow(fake204, undefined)) === false && called === 0);
  ok("fires with a token", (await triggerPostNow(fake204, "tok")) === true && called === 1);
  const fail401 = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  ok("bad token is not success", (await triggerPostNow(fail401, "tok")) === false);
  const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
  ok("never throws", (await triggerPostNow(boom, "tok")) === false);

  for (const f of ["app/dashboard/properties/distribution-actions.ts", "app/dashboard/admin/concierge-actions.ts"]) {
    const s = readFileSync(f, "utf8");
    const at = s.indexOf("await triggerPostNow();");
    ok(`${f} triggers after the approval`, at > 0 && at > s.indexOf("operator_submit_approved_at: now"));
    ok(`${f} keeps use server first`, s.startsWith('"use server"'));
  }

  console.log(`\npost-now: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
