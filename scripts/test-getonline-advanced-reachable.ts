// S675, re-pointed S705: the Facebook Page Connect / Disconnect controls must
// stay reachable.
//
// History: they lived only in the property page's "Advanced tools" channel
// cards (ChannelCard, behind GetOnlineView's simple/advanced toggle), and a
// layout flag once hid that toggle so nobody could connect or disconnect a
// Meta account at all. S705 moved them to Settings > Rental site accounts and
// cut the Advanced tools view. This test now guards the new home, and that the
// live-ad-link list (the one hand-entry point for a live ad URL) survived the cut.
//
// Run: npx tsx scripts/test-getonline-advanced-reachable.ts

import { existsSync, readFileSync } from "node:fs";
import { facebookReturnPath } from "../lib/facebook-page-oauth";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.error(`  x ${name}`);
  }
}

const card = readFileSync("app/dashboard/settings/facebook-page-card.tsx", "utf8");
const settings = readFileSync("app/dashboard/settings/page.tsx", "utf8");
const distribute = readFileSync(
  "app/dashboard/properties/[id]/distribute-tab.tsx",
  "utf8",
);

// Positive markers: the controls exist in Settings.
ok(
  "Settings card links to the Facebook connect route",
  card.includes('"/api/integrations/facebook/connect"') &&
    card.includes("Connect Facebook Page"),
);
ok(
  "Settings card has a Disconnect form wired to the server action",
  card.includes("action={disconnectFacebookPage}") && card.includes("Disconnect"),
);
ok(
  "Settings renders the card on the Rental site accounts tab",
  settings.includes("<FacebookPageCard") &&
    settings.indexOf("<FacebookPageCard") > settings.indexOf('tab === "distribution"'),
);
ok(
  "the card renders for every org, not only our team",
  !/isPlatformAdmin\s*&&\s*\(?\s*<FacebookPageCard/.test(settings),
);
ok(
  "a connect with no rental lands back on the Settings card",
  facebookReturnPath(null, "connected").startsWith("/dashboard/settings?") &&
    facebookReturnPath(null, "connected").includes("tab=distribution") &&
    facebookReturnPath(null, "connected").endsWith("#facebook-page"),
);
ok("Settings shows the connect / disconnect result", settings.includes("flash={searchParams.fb}"));

// The cut happened, and nothing now points at the removed view.
ok("get-online-view.tsx is gone", !existsSync("app/dashboard/properties/[id]/get-online-view.tsx"));
ok(
  "channel-publish-rail.tsx is gone",
  !existsSync("app/dashboard/properties/[id]/channel-publish-rail.tsx"),
);
ok("distribute-tab no longer imports GetOnlineView", !distribute.includes("GetOnlineView"));
ok("distribute-tab no longer renders ChannelCard", !distribute.includes("<ChannelCard"));
ok("distribute-tab no longer renders PartnerSection", !distribute.includes("<PartnerSection"));

// What must survive: a landlord can still save a live ad link by hand.
ok(
  "the live-ad-link list still renders under Publish Everywhere",
  distribute.includes("{publishEverywhereSurface}") &&
    distribute.includes("{liveAdLinks}") &&
    distribute.includes("<ChannelLinks") &&
    distribute.includes("action={addListingPost}"),
);

if (fail > 0) {
  console.error(`\n${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`${pass} passed`);
