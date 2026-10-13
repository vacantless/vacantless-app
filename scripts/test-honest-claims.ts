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

const leadPage = read("app/dashboard/leads/[id]/page.tsx");
ok(
  "lead page imports SCREENING_LIVE",
  leadPage.includes('import { SCREENING_LIVE } from "@/lib/screening-live"'),
);
ok("lead page drops the (coming next) promise", !leadPage.includes("(coming next)"));
const picker = leadPage.indexOf("Who pays for screening");
ok(
  "who-pays picker sits inside a SCREENING_LIVE branch",
  picker > 0 && leadPage.lastIndexOf("{SCREENING_LIVE ? (", picker) > picker - 400,
);
const upsell = leadPage.indexOf("built-in credit & background screening are part of");
ok(
  "Free upsell only mentions screening when SCREENING_LIVE",
  upsell > 0 && leadPage.lastIndexOf("SCREENING_LIVE", upsell) > upsell - 120,
);
ok(
  "Free upsell has a screening-free fallback",
  leadPage.includes('"Rental applications are part of "'),
);

// --- A. Apply page and action ---------------------------------------------
const applyPage = read("app/apply/[token]/page.tsx");
ok(
  "apply page imports SCREENING_LIVE",
  applyPage.includes('import { SCREENING_LIVE } from "@/lib/screening-live"'),
);
const credit = applyPage.indexOf("consumer credit report");
ok(
  "credit-check consent only renders when SCREENING_LIVE",
  credit > 0 && applyPage.lastIndexOf("{SCREENING_LIVE ? (", credit) > credit - 800,
);
const partner = applyPage.indexOf("from our screening partner");
ok(
  "screening-partner note only renders when SCREENING_LIVE",
  partner > 0 && applyPage.lastIndexOf("{SCREENING_LIVE", partner) > partner - 300,
);
ok(
  "screening-off form keeps a required certify box",
  /name="certify" value="1" required/.test(applyPage),
);

const applyAction = read("app/apply/[token]/actions.ts");
ok(
  "action reads credit consent only when SCREENING_LIVE",
  /SCREENING_LIVE\s*\?\s*formData\.get\("consent"\) != null\s*:\s*formData\.get\("certify"\) != null/.test(
    applyAction,
  ),
);

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
