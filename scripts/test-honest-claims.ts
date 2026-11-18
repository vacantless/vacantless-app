// S712 honest claims: the product must not promise screening, partner-site
// sending, or AI replies it does not deliver.
// Run: npx tsx scripts/test-honest-claims.ts
import { readFileSync } from "node:fs";
import { SCREENING_LIVE } from "../lib/screening-live";
import { networkFeedLive } from "../lib/network-feed-live";

let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- A. Screening is gated by one constant ---------------------------------
ok("SCREENING_LIVE is off until SingleKey is wired", SCREENING_LIVE === false);

// S816 (Noam 2026-11-17): the landlord runs the credit check with their own
// screening company. The applicant signs an authorization that names the
// landlord "and any screening company it uses"; the product never says
// Vacantless runs the check, and the "next step" only shows when the account
// has saved its own link.
const card = read("app/dashboard/leads/[id]/application-card.tsx");
ok("lead card drops the (coming next) promise", !card.includes("(coming next)"));
ok("lead card has no who-pays picker", !card.includes("Who pays for screening"));
ok("lead card never says built-in screening", !card.includes("built-in credit"));

const applyPage = read("app/apply/[token]/page.tsx");
ok("apply page has no screening-partner promise", !applyPage.includes("from our screening partner"));
const step = applyPage.indexOf("Start my credit check");
ok(
  "credit step only renders with the account's own link",
  step > 0 && applyPage.lastIndexOf("app.screening_link_url ?", step) > step - 1200,
);
ok("apply page signs with a typed name", /name="signed_name"/.test(applyPage) && /name="agree"/.test(applyPage));
const words = read("lib/rental-application.ts");
ok("consent names the landlord's screening company, not Vacantless", words.includes("any screening company it uses") && !/Vacantless (will|runs)/.test(words));

const applyAction = read("app/apply/[token]/actions.ts");
ok("action requires the agree box and a matching signature", applyAction.includes('formData.get("agree")') && applyAction.includes("validateTypedSignature"));

// --- B. Marketing kit inFeed needs the feed env gate -----------------------
ok("networkFeedLive false with no token", networkFeedLive({}) === false);
ok("networkFeedLive false with blank token", networkFeedLive({ NETWORK_FEED_TOKEN: "  " }) === false);
ok("networkFeedLive true with a token", networkFeedLive({ NETWORK_FEED_TOKEN: "abc" }) === true);

const propertyPage = read("app/dashboard/properties/[id]/page.tsx");
ok(
  "marketing kit inFeed requires networkFeedLive",
  propertyPage.includes("const marketingFeedLive = networkFeedLive();") &&
    propertyPage.includes("inFeed: marketingFeedLive && marketingFeedSignal.ok"),
);
const kit = read("app/dashboard/properties/[id]/marketing-kit-card.tsx");
ok("marketing kit never says it sent the rental", !/We sent this rental|Sent to our partner sites/.test(kit));

// --- C. Reply button is a template, not AI ---------------------------------
const reply = read("app/dashboard/leads/inquiry-reply-panel.tsx");
ok("reply button says Draft a reply", reply.includes('"Draft a reply"'));
ok("reply button no longer says AI draft", !reply.includes('"AI draft"') && !reply.includes("AI draft added"));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
