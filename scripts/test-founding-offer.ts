// Run with: npx tsx scripts/test-founding-offer.ts
import {
  foundingChannel,
  foundingOfferVisible,
  foundingSpotsLeft,
  foundingTrialCap,
  foundingTrialEnd,
  FOUNDING20_SPOTS,
} from "../lib/founding-offer";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`);
  }
}

const DAY = 86_400;
const T0 = Date.UTC(2026, 10, 1, 15, 0, 0) / 1000; // Nov 1 2026

// channel
eq("param wins", foundingChannel({ param: "warm", signupSource: { source: "founding", campaign: "ads" } }), "warm");
eq("param case-folded", foundingChannel({ param: "AGENT" }), "agent");
eq("unknown param is other", foundingChannel({ param: "facebook" }), "other");
eq("signup source founding/assoc", foundingChannel({ signupSource: { source: "founding", campaign: "assoc" } }), "assoc");
eq("signup source founding, odd campaign", foundingChannel({ signupSource: { source: "Founding", campaign: "x" } }), "other");
eq("google ads source is not founding", foundingChannel({ signupSource: { source: "google", campaign: "warm" } }), null);
eq("nothing", foundingChannel({}), null);

// visible
const base = { channel: "warm" as const, plan: "free", hasSubscription: false, billingReady: true };
eq("visible: free with link", foundingOfferVisible(base), true);
eq("hidden: no link", foundingOfferVisible({ ...base, channel: null }), false);
eq("hidden: already subscribed", foundingOfferVisible({ ...base, hasSubscription: true }), false);
eq("hidden: growth plan", foundingOfferVisible({ ...base, plan: "growth" }), false);
eq("hidden: billing not set up", foundingOfferVisible({ ...base, billingReady: false }), false);
eq("visible: null plan counts as free", foundingOfferVisible({ ...base, plan: null }), true);

// spots
eq("spots: none used", foundingSpotsLeft(0), FOUNDING20_SPOTS);
eq("spots: 19 used", foundingSpotsLeft(19), 1);
eq("spots: full", foundingSpotsLeft(20), 0);
eq("spots: over", foundingSpotsLeft(25), 0);
eq("spots: junk", foundingSpotsLeft(NaN), FOUNDING20_SPOTS);

// cap
eq("cap is 90 days", foundingTrialCap(T0), T0 + 90 * DAY);

// trial end
const cap = T0 + 90 * DAY;
eq("no booking: leave", foundingTrialEnd({ createdSec: T0, trialEndSec: cap, firstBookingSec: null, nowSec: T0 + DAY }), null);
eq("booking day 5: end day 35", foundingTrialEnd({ createdSec: T0, trialEndSec: cap, firstBookingSec: T0 + 5 * DAY, nowSec: T0 + 6 * DAY }), T0 + 35 * DAY);
eq("booking day 70: capped at 90", foundingTrialEnd({ createdSec: T0, trialEndSec: cap, firstBookingSec: T0 + 70 * DAY, nowSec: T0 + 71 * DAY }), null);
eq("already shortened: leave", foundingTrialEnd({ createdSec: T0, trialEndSec: T0 + 35 * DAY, firstBookingSec: T0 + 5 * DAY, nowSec: T0 + 6 * DAY }), null);
eq("booking on the first day: end day 30", foundingTrialEnd({ createdSec: T0, trialEndSec: cap, firstBookingSec: T0 + 3600, nowSec: T0 + 7200 }), T0 + 3600 + 30 * DAY);
eq("job late, target passed: now", foundingTrialEnd({ createdSec: T0, trialEndSec: cap, firstBookingSec: T0 + 5 * DAY, nowSec: T0 + 40 * DAY }), "now");
eq("no trial end: leave", foundingTrialEnd({ createdSec: T0, trialEndSec: null, firstBookingSec: T0 + 5 * DAY, nowSec: T0 + 6 * DAY }), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
