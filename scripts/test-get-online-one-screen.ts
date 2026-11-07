// Run with: npx tsx scripts/test-get-online-one-screen.ts
// S761 (REVIEW-S761 item 4): one status on the Get online tab, Instagram out
// of the rental-sites list until connected.
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");

ok("headline reads On N of M sites", /`On \$\{proofSavedCount\} of \$\{siteRowCount\}/.test(pe));
ok("old Live on N sites headline is gone", !/`Live on \$\{proofSavedCount\}/.test(pe));
ok("Instagram leaves the list until connected", /r\.key === "instagram" && r\.mode === "needs_connection"/.test(pe));
ok("other rows pass through the site filter", /\.filter\(isSiteRow\)\}/.test(pe));
ok("the black box steps aside once live on a site with nothing in the way", /liveListingPostCount > 0 &&\s*syndicationBlockerSummary == null/.test(page));
console.log(`get-online-one-screen: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
