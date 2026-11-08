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

// S762 (REVIEW-S761 item 4, the rest): one sentence, one button, More.
import { forYouRowState, needsYouSentence } from "../lib/for-you-row-state";
const tab = readFileSync("app/dashboard/properties/[id]/distribute-tab.tsx", "utf8");
const base = {
  rowKey: "kijiji", item: null, liveProofUrl: null, retiredUrls: [], alreadySignedIn: true,
  addonLocked: false, postingBlocked: false, hasMarketplaceKit: false,
};
ok("live ad reads On", forYouRowState({ ...base, liveProofUrl: "https://www.kijiji.ca/v-x/1" }).word === "On");
ok("pay at checkout reads Needs you", forYouRowState({ ...base, item: { mode: "concierge", publishStatus: "needs_payment", checkoutUrl: "https://www.kijiji.ca/p", externalUrl: null } }).word === "Needs you");
ok("queued and signed in reads Posting", forYouRowState({ ...base, item: { mode: "concierge", publishStatus: "queued", externalUrl: null } }).word === "Posting");
ok("never signed in reads Needs you", forYouRowState({ ...base, alreadySignedIn: false }).word === "Needs you");
ok("no add-on reads the add-on chip", forYouRowState({ ...base, alreadySignedIn: false, addonLocked: true }).word === "addon");
ok("signed out reads Needs you", forYouRowState({ ...base, item: { mode: "concierge", publishStatus: "needs_login", externalUrl: null } }).word === "Needs you");
ok("one site needs you", needsYouSentence(["Kijiji"]) === "Kijiji needs you.");
ok("two sites need you", needsYouSentence(["Kijiji", "Zumper"]) === "Kijiji and Zumper need you.");
ok("three sites need you", needsYouSentence(["Kijiji", "Zumper", "Rentals.ca"]) === "Kijiji, Zumper and Rentals.ca need you.");
ok("nobody needs you: no sentence", needsYouSentence([]) === "");
ok("the row reads the shared state", pe.includes("} = forYouRowState({") && pe.includes("word === \"addon\""));
ok("headline names the sites that need you", pe.includes("needsYouSentence(needsYouRows.map((r) => r.label))"));
ok("one button, only when a site needs you", pe.includes("{!postingBlocker && firstNeedsYou && (") && pe.includes("href={`#for-you-${firstNeedsYou.key}`}"));
ok("posting every site again is under More", /<summary className="cursor-pointer font-semibold">More<\/summary>[\s\S]{0,900}Post every site again/.test(pe));
ok("old Post your edits button is gone", !pe.includes("Post your edits to every site"));
ok("site names are 16 px", pe.includes('<span className="text-base font-semibold text-gray-800">{row.label}</span>'));
ok("row buttons are full width on a phone", (pe.match(/inline-flex w-full items-center justify-center gap-1 rounded-lg sm:w-auto/g) ?? []).length >= 3);
ok("Get online has one More", tab.includes('id="get-online-more"') && tab.includes("{more}"));
ok("Keep it fresh moved under More", !/<\/TabPanel>[\s\S]{0,40}$/.test("") && page.indexOf("<KeepFreshCard") > page.indexOf("more={"));
ok("Relist in the header only for a leased rental", page.includes('{showRelistOneTap && normalizedStatus === "leased" && ('));
ok("Relist under More on a live rental", page.includes('{showRelistOneTap && normalizedStatus !== "leased" && ('));
ok("More opens after a weekly-posts save", page.includes('moreOpen={typeof searchParams.pageposts === "string"}'));
console.log(`get-online-one-screen: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
