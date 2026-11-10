// Run with: npx tsx scripts/test-sites-setup.ts
// S760: the one-time "Connect your rental sites" step and the one vocabulary
// on a rental's Get online tab (REVIEW-S760 sections 3 and 4).
import { readFileSync } from "node:fs";
import { buildSitesSetup, orgHasConnectedSite, signinChainHref, SITES_SETUP_HREF } from "../lib/sites-setup";
import { computeOnboardingState } from "../lib/onboarding-wizard";
import { countWords, splitSentences } from "../lib/i18n/plain-words";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const base = { postingAllowed: true, helperInstalled: null as boolean | null, postingHref: "/dashboard/billing#posting-addon" };

// --- 1. A stranger: nothing connected -----------------------------------------
const fresh = buildSitesSetup({ ...base, tileStateByChannel: {} });
ok("five rows", fresh.rows.length === 5);
ok("order: Page, Marketplace, Kijiji, Rentals.ca, Zumper", fresh.rows.map((r) => r.key).join(",") === "facebook_feed,facebook_marketplace,kijiji,rentals_ca,zumper");
ok("nothing on", fresh.connectedCount === 0 && fresh.progress === "0 of 5 connected");
ok("not done", !fresh.done);
ok("every row needs you", fresh.rows.every((r) => r.state === "needs_you"));
ok("every row has one action", fresh.rows.every((r) => r.action != null));
ok("Page connects by OAuth", fresh.rows[0].action?.href === "/api/integrations/facebook/connect");
ok("Marketplace installs the helper", /chromewebstore/.test(fresh.rows[1].action?.href ?? "") && fresh.rows[1].action?.external === true);
ok("Marketplace says the one rule", /only lets a person press Post|On your phone/.test(fresh.rows[1].note ?? ""));
ok("robot rows open the chained sign-in", fresh.rows.slice(2).every((r) => r.action?.href === "/dashboard/site-signin"));
ok("next sign-in is Kijiji", fresh.nextSignin === "kijiji");
ok("Zumper warns about the ID check", /ID/.test(fresh.rows[4].note ?? ""));
ok("summary says do it once", /once/i.test(fresh.summary));

// --- 2. Helper detected in this browser ---------------------------------------
const withHelper = buildSitesSetup({ ...base, tileStateByChannel: {}, helperInstalled: true });
ok("helper on", withHelper.rows[1].state === "on" && withHelper.rows[1].action == null);
ok("helper counts as connected", withHelper.connectedCount === 1 && withHelper.done);
const noHelper = buildSitesSetup({ ...base, tileStateByChannel: {}, helperInstalled: false });
ok("helper absent on a computer: install", noHelper.rows[1].state === "needs_you" && /20 seconds/.test(noHelper.rows[1].line));
ok("helper unknown (phone): kit line", /phone/.test(fresh.rows[1].note ?? ""));

// --- 3. Sites connected ---------------------------------------------------------
const some = buildSitesSetup({ ...base, tileStateByChannel: { facebook_feed: "linked", kijiji: "linked", zumper: "dead_session", rentals_ca: "checking" } });
ok("Page on", some.rows[0].state === "on");
ok("Kijiji on", some.rows[2].state === "on" && /renew and take down/.test(some.rows[2].line));
ok("Rentals.ca checking", some.rows[3].state === "checking" && some.rows[3].action == null);
ok("Zumper sign in again", some.rows[4].state === "needs_you" && some.rows[4].action?.label === "Sign in again");
ok("next sign-in skips signed-in Kijiji", some.nextSignin === "zumper");
ok("2 of 5", some.progress === "2 of 5 connected" && some.done);
const all = buildSitesSetup({ ...base, helperInstalled: true, tileStateByChannel: { facebook_feed: "linked", kijiji: "linked", zumper: "linked", rentals_ca: "linked" } });
ok("all five on", all.connectedCount === 5 && all.nextSignin === null && /goes up on each one/.test(all.summary));
const needsOk = buildSitesSetup({ ...base, tileStateByChannel: { facebook_feed: "connected_needs_authorization" } });
ok("Page connected but not allowed: Allow posting", needsOk.rows[0].state === "needs_you" && needsOk.rows[0].action?.label === "Allow posting");

// --- 4. Free account: robot sites say With Posting, never Needs you ---------------
const free = buildSitesSetup({ ...base, postingAllowed: false, tileStateByChannel: {} });
ok("robot rows read With Posting", free.rows.slice(2).every((r) => r.state === "with_posting" && /\$49/.test(r.line)));
ok("one Add Posting button each, to Billing", free.rows.slice(2).every((r) => r.action?.href === base.postingHref));
ok("free never chains a sign-in", free.nextSignin === null);
ok("free summary after the free sites", buildSitesSetup({ ...base, postingAllowed: false, helperInstalled: true, tileStateByChannel: { facebook_feed: "linked" } }).summary.includes("Add Posting"));

// --- 5. Hidden sites and the property link -----------------------------------------
const hidden = buildSitesSetup({ ...base, tileStateByChannel: {}, hiddenFor: (c) => c === "rentals_ca" });
ok("hidden site dropped", hidden.rows.length === 4 && !hidden.rows.some((r) => r.key === "rentals_ca"));
ok("property carried into the chain link", signinChainHref("1ed3b06e-9022-43c9-9716-cbadc951140f") === "/dashboard/site-signin?property=1ed3b06e-9022-43c9-9716-cbadc951140f");
ok("no property: bare chain link", signinChainHref(null) === "/dashboard/site-signin");

// --- 6. Server-side "has a connected site" ------------------------------------------
ok("page linked counts", orgHasConnectedSite({ facebook_feed: "linked" }));
ok("robot linked counts", orgHasConnectedSite({ kijiji: "linked" }));
ok("dead session does not", !orgHasConnectedSite({ kijiji: "dead_session" }));
ok("not linked does not", !orgHasConnectedSite({ kijiji: "not_linked", facebook_feed: "not_linked" }));
ok("nothing does not", !orgHasConnectedSite({}));

// --- 7. The onboarding step ---------------------------------------------------------
const stepBase = { hasProperty: true, hasLiveListing: false, hasTenancy: false, wizardEnabled: false, railStepDoneAt: null, dismissedAt: null, hasViewingTimes: true };
const noSites = computeOnboardingState({ ...stepBase, hasConnectedSite: false });
ok("connect step shown and current", noSites.nextIncompleteStep?.key === "connect_sites");
ok("connect step opens the sites page", noSites.nextIncompleteStep?.href === "/dashboard/sites?from=getting-started");
ok("connect step sits before Set Live", noSites.steps.findIndex((s) => s.key === "connect_sites") < noSites.steps.findIndex((s) => s.key === "get_online"));
const sites = computeOnboardingState({ ...stepBase, hasConnectedSite: true });
ok("connected: next is Set Live", sites.nextIncompleteStep?.key === "get_online" && sites.steps.find((s) => s.key === "connect_sites")?.status === "complete");
const legacy = computeOnboardingState(stepBase);
ok("caller without the input: step hidden (back-compat)", !legacy.steps.some((s) => s.key === "connect_sites"));
const liveAd = computeOnboardingState({ ...stepBase, hasConnectedSite: false, hasLiveListing: true });
ok("a live ad counts the connect step done", liveAd.steps.find((s) => s.key === "connect_sites")?.status === "complete");
ok("Set Live step says we post everywhere", /every site you connected/.test(sites.steps.find((s) => s.key === "get_online")?.description ?? ""));

// --- 8. Copy rules -------------------------------------------------------------------
const copy = [fresh, withHelper, some, all, free].flatMap((s) => s.rows.flatMap((r) => [r.line, r.note ?? "", r.action?.label ?? ""]).concat(s.summary));
ok("no em dash", !copy.join(" ").includes("—"));
ok("no parentheses", !/[()]/.test(copy.join(" ")));
ok("no mechanism words (robot, extension, API, noVNC)", !/\brobot\b|extension|\bAPI\b|noVNC/i.test(copy.join(" ")));
ok("sentences stay short", copy.every((t) => splitSentences(t).every((sn) => countWords(sn) <= 22)));

// --- 9. Wiring -------------------------------------------------------------------------
const pe = read("app/dashboard/properties/[id]/publish-everywhere.tsx");
// S762: the row's rules moved to lib/for-you-row-state; the chip reads its word.
const rs = read("lib/for-you-row-state.ts");
ok("chips use the four words", rs.includes('? "On"') && rs.includes('? "Posting"') && rs.includes('"Needs you"') && pe.includes("{ label: word, cls: SITE_WORD_CLASS[word] }"));
for (const old of ['"Live"', '"Getting it ready"', '"We\'re posting it"', '"Needs a repost"', '"Not posted yet"', '"Sign-in needed"', '"Ready. Approve it"', '"Ready. Pay the site"', "Add this site →"]) {
  ok(`old chip gone: ${old}`, !pe.includes(old));
}
ok("sign-in-first branch exists", rs.includes("const signinFirst =") && rs.includes("input.alreadySignedIn !== true") && rs.includes("!(working || payAtCheckout || needsApproval || needsConnect)") && pe.includes(") : signinFirst ? ("));
ok("sign-in-first opens the sites setup", pe.includes("`${SITES_SETUP_HREF}?property=${encodeURIComponent(propertyId)}`"));
const actions = read("app/dashboard/properties/actions.ts");
const sp = actions.split("export async function startSitePost(")[1]?.split("\nexport async function ")[0] ?? "";
ok("startSitePost checks the sign-in before queueing", sp.includes('.eq("automation_authorized", true)') && sp.includes("redirect(`${SITES_SETUP_HREF}?property="));
ok("sites page exists", read("app/dashboard/sites/page.tsx").includes("Connect your rental sites"));
ok("sites rows ping the helper", read("app/dashboard/sites/sites-rows.tsx").includes("isHelperPong"));
ok("getting started passes the input", read("app/dashboard/(wizard)/getting-started/page.tsx").includes("hasConnectedSite: orgHasConnectedSite("));
ok("Today passes the input", read("app/dashboard/page.tsx").includes("hasConnectedSite: onboardingHasConnectedSite"));
ok("Marketplace row introduces Quick replies", read("app/dashboard/properties/[id]/marketplace-row.tsx").includes('href="/dashboard/replies"'));
const home = read("app/page.tsx");
ok("homepage step 3 is Set Live, not paste", home.includes('title: "Press Set Live"') && !home.includes("Paste it into Facebook Marketplace, Kijiji or any ad"));
ok("homepage hero names the arc (S779 wording)", home.includes("Ads posted and kept up, every renter answered and booked, then rent, repairs, notices and taxes on any paid plan."));
ok("homepage names the T776 and the accountant zip", home.includes("T776 rental tax summary") && home.includes("One zip for your accountant"));
ok("homepage names rent collection in the automations", home.includes("Rent in on the first"));
ok("SITES_SETUP_HREF", SITES_SETUP_HREF === "/dashboard/sites");

// --- S770 (REVIEW-S770 section 3 item 3): "I don't have a Facebook Page" ------
const noPage = buildSitesSetup({ ...base, tileStateByChannel: {}, facebookPageSkipped: true });
ok("S770: skipped Page leaves the list", noPage.rows.length === 4 && !noPage.rows.some((r) => r.key === "facebook_feed"));
ok("S770: the count no longer waits on it", noPage.total === 4 && noPage.progress === "0 of 4 connected" && noPage.facebookPageSkipped);
ok("S770: an unconnected Page row offers the skip", fresh.rows[0].secondary?.kind === "skip_facebook_page");
const linkedSkipped = buildSitesSetup({ ...base, tileStateByChannel: { facebook_feed: "linked" }, facebookPageSkipped: true });
ok("S770: a linked Page wins over the stamp", linkedSkipped.rows[0]?.key === "facebook_feed" && linkedSkipped.rows[0].state === "on" && !linkedSkipped.facebookPageSkipped);
ok("S770: a connected Page row has no skip", linkedSkipped.rows[0].secondary == null);
const allSet = buildSitesSetup({ ...base, tileStateByChannel: { kijiji: "linked", rentals_ca: "linked", zumper: "linked" }, helperInstalled: true, facebookPageSkipped: true });
ok("S770: with the Page skipped, four connected reads every site connected", allSet.connectedCount === allSet.total && /Every site is connected/.test(allSet.summary));
const rowsTsx = read("app/dashboard/sites/sites-rows.tsx");
ok("S770: the row's skip posts the server action", rowsTsx.includes('row.secondary?.kind === "skip_facebook_page"') && rowsTsx.includes("action={setFacebookPageSkipped}"));
ok("S770: Add it back when skipped", rowsTsx.includes("Facebook Page skipped.") && rowsTsx.includes("Add it back"));
const propPage = read("app/dashboard/properties/[id]/page.tsx");
ok("S770: the rental's site list drops the skipped Page", propPage.includes('(k) => k !== "facebook_feed"') && propPage.includes("org?.facebook_page_skipped_at"));

console.log(`\nsites-setup: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
