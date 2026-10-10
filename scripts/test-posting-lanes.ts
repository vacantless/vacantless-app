// Run with: npx tsx scripts/test-posting-lanes.ts
// S702v: robot sites never use the desk allowance; Marketplace only for hand-posting orgs.
import { readFileSync } from "node:fs";
import {
  isHiddenMarketplace,
  isRobotPostedChannel,
  marketplaceShownFor,
  usesDeskAllowance,
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

// --- wiring ---
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("desk claim gated on usesDeskAllowance", actions.includes('CONCIERGE_DESK_ENABLED === "true" && usesDeskAllowance(item.channel)'));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page narrows shown channels", page.includes("withoutHiddenMarketplace("));
ok("header summary skips hidden Marketplace", page.includes("isHiddenMarketplace(card.channel.key, org?.id)"));
const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("robot sites say Post it for me", pe.includes('isRobotPostedChannel(row.key) ? "Post it for me →"'));
ok("no monthly posts line", !pe.includes("monthly posts"));
const vm = readFileSync("app/dashboard/link-portals/view-model.ts", "utf8");
ok("sign-in page hides Marketplace", vm.includes("isHiddenMarketplace(row.channel, orgId)"));

console.log(`\nposting-lanes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
