// Run with: npx tsx scripts/test-posting-lanes.ts
// S702v: robot sites never use the desk allowance; Marketplace only for hand-posting orgs.
import { readFileSync } from "node:fs";
import {
  channelShownFor,
  isHiddenForOrg,
  isHiddenMarketplace,
  isRobotPostedChannel,
  marketplaceShownFor,
  usesDeskAllowance,
  withoutHiddenChannels,
  withoutHiddenMarketplace,
} from "../lib/posting-lanes";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const AGILE = "921f7c08-98af-428f-a238-36f4a781b0de";
const OTHER = "00000000-0000-0000-0000-000000000001";

for (const ch of ["kijiji", "rentals_ca", "zumper"]) {
  ok(`${ch} is robot posted`, isRobotPostedChannel(ch));
  ok(`${ch} skips the desk allowance`, !usesDeskAllowance(ch));
}
ok("marketplace uses the desk allowance", usesDeskAllowance("facebook"));
ok("realtor.ca uses the desk allowance", usesDeskAllowance("realtor_ca"));
ok("junk input is not robot posted", !isRobotPostedChannel(null));

ok("Agile sees Marketplace", marketplaceShownFor(AGILE));
ok("other org does not", !marketplaceShownFor(OTHER));
ok("no org does not", !marketplaceShownFor(null));
ok("Marketplace hidden for other org", isHiddenMarketplace("facebook", OTHER));
ok("Marketplace shown for Agile", !isHiddenMarketplace("facebook", AGILE));
ok("Kijiji never hidden", !isHiddenMarketplace("kijiji", OTHER));

const all = ["site", "facebook", "kijiji", "zumper"];
ok("Agile keeps null (show all)", withoutHiddenMarketplace(null, all, AGILE) === null);
ok(
  "other org drops facebook from all",
  JSON.stringify(withoutHiddenMarketplace(null, all, OTHER)) === JSON.stringify(["site", "kijiji", "zumper"]),
);
ok(
  "other org drops facebook from a proven list",
  JSON.stringify(withoutHiddenMarketplace(["facebook", "kijiji"], all, OTHER)) === JSON.stringify(["kijiji"]),
);

// S704: Rentals.ca is Agile-only (the GitHub robot cannot pass its Cloudflare).
ok("Agile sees Rentals.ca", channelShownFor("rentals_ca", AGILE));
ok("other org does not see Rentals.ca", isHiddenForOrg("rentals_ca", OTHER));
ok("no org does not see Rentals.ca", isHiddenForOrg("rentals_ca", null));
ok("other org does not see Marketplace", isHiddenForOrg("facebook", OTHER));
ok("Kijiji shown for other org", channelShownFor("kijiji", OTHER));
ok("Zumper shown for other org", channelShownFor("zumper", OTHER));
ok("Zumper shown with no org", channelShownFor("zumper", null));
const all2 = ["site", "facebook", "kijiji", "rentals_ca", "zumper"];
ok("Agile keeps null via withoutHiddenChannels", withoutHiddenChannels(null, all2, AGILE) === null);
ok(
  "other org drops facebook and rentals_ca from all",
  JSON.stringify(withoutHiddenChannels(null, all2, OTHER)) === JSON.stringify(["site", "kijiji", "zumper"]),
);
ok(
  "other org drops rentals_ca from a proven list",
  JSON.stringify(withoutHiddenChannels(["rentals_ca", "zumper"], all2, OTHER)) === JSON.stringify(["zumper"]),
);
ok(
  "Agile keeps a proven list as is",
  JSON.stringify(withoutHiddenChannels(["rentals_ca", "facebook"], all2, AGILE)) === JSON.stringify(["rentals_ca", "facebook"]),
);

// --- wiring ---
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("desk claim gated on usesDeskAllowance", actions.includes('CONCIERGE_DESK_ENABLED === "true" && usesDeskAllowance(item.channel)'));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page narrows shown channels", page.includes("withoutHiddenChannels("));
ok("header summary skips hidden sites", page.includes("isHiddenForOrg(card.channel.key, org?.id)") && page.includes("isHiddenForOrg(item.channel, org?.id)"));
const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("robot sites say Post it for me", pe.includes('isRobotPostedChannel(row.key) ? "Post it for me →"'));
ok("no monthly posts line", !pe.includes("monthly posts"));
const vm = readFileSync("app/dashboard/link-portals/view-model.ts", "utf8");
ok("sign-in page hides org-only sites", vm.includes("isHiddenForOrg(row.channel, orgId)"));
ok("Add this site refuses a hidden site", actions.includes("if (isHiddenForOrg(channel, org.id))"));

// S702w: Rentals.ca and Zumper reach the robot through the app.
ok("Add this site accepts robot sites", actions.includes("isCopilotChannel(channel) || isRobotPostedChannel(channel)"));
ok("page marks authorized robot sites ready", page.includes("isRobotPostedChannel(channel.key) &&") && page.includes("robotReady: card.robotReady === true"));
ok("publish surface passes robotReady", pe.includes("robotReady: card.robotReady === true"));

// S703: a site whose ad died can be posted again from the app.
ok("dead live item offers Post it again", pe.includes('item.publishStatus === "live"') && pe.includes("item == null || repostable") && pe.includes('"Post it again →"'));

console.log(`\nposting-lanes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
