// S713: "Post everywhere" on a Live rental with no posting run still reaches a
// connected Facebook Page. Run: npx tsx scripts/test-instant-run-open.ts
import { readFileSync } from "node:fs";
import { instantAutofireChannelsForAccounts } from "../lib/channel-publish-autofire";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const fb = { channel: "facebook_feed", accountStatus: "connected", automationAuthorized: true };
const ig = { channel: "instagram", accountStatus: "connected", automationAuthorized: true };
ok("connected + allowed Page is picked", instantAutofireChannelsForAccounts([fb], false).join() === "facebook_feed");
ok("not allowed is skipped", instantAutofireChannelsForAccounts([{ ...fb, automationAuthorized: false }], false).length === 0);
ok("not connected is skipped", instantAutofireChannelsForAccounts([{ ...fb, accountStatus: "needs_setup" }], false).length === 0);
ok("instagram only when enabled", instantAutofireChannelsForAccounts([fb, ig], false).join() === "facebook_feed");
ok("instagram when enabled", instantAutofireChannelsForAccounts([fb, ig], true).includes("instagram"));
ok("robot sites never picked", instantAutofireChannelsForAccounts([{ channel: "kijiji", accountStatus: "connected", automationAuthorized: true }], true).length === 0);

const a = readFileSync("app/dashboard/properties/actions.ts", "utf8");
const i = a.indexOf("async function publishAuthorizedInstantChannelsAfterPageLive(");
const body = a.slice(i, a.indexOf("\nexport async function ", i));
ok("opens a run when none exists", body.includes('.insert({ organization_id: orgId, property_id: propertyId, status: "active" })'));
ok("queues missing instant items as automatic", body.includes('mode: "automatic"') && body.includes('publish_status: "queued"'));
ok("opens the run before selecting items", body.indexOf("instantAutofireChannelsForAccounts(") < body.indexOf("selectChannelPublishAutofireItems("));

console.log(`\ninstant-run-open: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
