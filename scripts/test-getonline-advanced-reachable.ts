// S675: the advanced Get online surface must stay reachable under every layout flag.
//
// Regression guarded: PUBLISH_SIMPLE_DEFAULT_ENABLED=true used to render
// `publishEverywhereSurface` bare, dropping `advancedTools` AND the
// GetOnlineView simple/advanced toggle that is the only way back to it.
// advancedTools owns ChannelCard, and ChannelCard owns the Facebook Page /
// Instagram "Connect Facebook Page" and "Disconnect" controls. With the flag on
// there was no UI route to connect or disconnect a Meta account at all, on any
// property, in any org - while the Get online tab still advertised the channels.
//
// Run: npx tsx scripts/test-getonline-advanced-reachable.ts

import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.error(`  x ${name}`);
  }
}

const distributeSource = readFileSync(
  "app/dashboard/properties/[id]/distribute-tab.tsx",
  "utf8",
);

// Positive markers only. Do NOT gate on the absence of the old expression:
// a future refactor can reintroduce the defect with different wording.
const advancedWirings = distributeSource.split("advanced={advancedTools}").length - 1;
ok(
  "every layout branch wires the advanced surface (2 GetOnlineView call sites)",
  advancedWirings === 2,
);

const getOnlineViewRenders = distributeSource.split("<GetOnlineView").length - 1;
ok(
  "both layout branches render GetOnlineView, which owns the simple/advanced toggle",
  getOnlineViewRenders === 2,
);

ok(
  "the simple-default branch pins simple as the initial mode, not as the only mode",
  distributeSource.includes('orgDefaultMode="simple"'),
);

// The controls the surface exists to expose.
ok(
  "ChannelCard still renders the Facebook Page connect entry point",
  distributeSource.includes("Connect Facebook Page"),
);
const disconnectForms =
  distributeSource.split("action={disconnectFacebookPage}").length - 1;
ok(
  "both the Facebook Page row and the Instagram row keep a Disconnect form",
  disconnectForms === 2,
);
ok(
  "the connect/disconnect block is still gated per org, not removed",
  distributeSource.includes('channel.key === "facebook_feed" && facebookPage?.enabled') &&
    distributeSource.includes('channel.key === "instagram" && instagramAccount?.enabled'),
);

const getOnlineViewSource = readFileSync(
  "app/dashboard/properties/[id]/get-online-view.tsx",
  "utf8",
);
ok(
  "GetOnlineView still offers a route into advanced mode",
  getOnlineViewSource.includes('setAndStore("advanced")') &&
    getOnlineViewSource.includes("{advanced}"),
);

if (fail > 0) {
  console.error(`\n${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`${pass} passed`);
