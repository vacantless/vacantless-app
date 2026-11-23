// S830i: queuing a Kijiji edit or a Kijiji/Zumper takedown wakes takedown-sites at once.
// Run: npx tsx scripts/test-s830i-takedown-now.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAKEDOWN_NOW_EVENT, triggerTakedownNow } from "../lib/post-now";

async function main() {
  let n = 0;
  let sent: { url: string; body: string } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    sent = { url, body: String(init.body) };
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  assert.equal(await triggerTakedownNow(fake, "tok"), true);
  assert.ok(sent && (sent as { url: string }).url.endsWith("/dispatches"));
  assert.equal(JSON.parse((sent as unknown as { body: string }).body).event_type, "takedown-now");
  assert.equal(TAKEDOWN_NOW_EVENT, "takedown-now");
  n += 4;
  assert.equal(await triggerTakedownNow(fake, undefined), false, "no token, no call");
  n++;
  const edit = readFileSync("lib/robot-edit.ts", "utf8");
  const take = readFileSync("lib/robot-takedown.ts", "utf8");
  assert.ok(edit.includes("if (queued.length > 0) await triggerTakedownNow();"), "edits wake the run");
  assert.ok(take.includes('o.portal === "kijiji" || o.portal === "zumper"') && take.includes("await triggerTakedownNow()"), "takedowns wake the run");
  n += 2;
  console.log(`s830i takedown now: ${n} passed, 0 failed`);
}
main();
