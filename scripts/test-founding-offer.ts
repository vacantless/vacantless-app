// Run with: npx tsx scripts/test-founding-offer.ts
import {
  foundingChannel,
  foundingOfferVisible,
  foundingSpotsLeft,
  foundingTrialCap,
  foundingTrialEnd,
  FOUNDING20_SPOTS,
  foundingTrialEmail,
  foundingReminderDue,
  foundingReminderEmail,
  FOUNDING20_CHECKOUT_NOTE,
  FOUNDING20_COUPON_NAME,
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

// S731e: the free-time email and checkout note
{
  const end = Date.UTC(2026, 10, 30, 17, 0, 0) / 1000; // Mon Nov 30 2026, noon Toronto
  const m = foundingTrialEmail({ endSec: end, nowSec: end - 30 * DAY, timeZone: "America/Toronto" });
  eq("email subject names the day", m.subject, "Your first viewing is booked: free until Monday, November 30");
  eq("email body has $49 and the day", /November 30/.test(m.body) && /\$49 a month/.test(m.body), true);
  const n = foundingTrialEmail({ endSec: "now", nowSec: end });
  eq("ended-now subject", n.subject, "Your founding free time has ended");
  eq("no em dash in emails", /\u2014/.test(m.body + n.body + m.subject + FOUNDING20_CHECKOUT_NOTE), false);
  eq("checkout note under Stripe's 1200 char limit", FOUNDING20_CHECKOUT_NOTE.length < 1200, true);
  eq("coupon name within Stripe's 40 characters", FOUNDING20_COUPON_NAME.length <= 40, true);
}
{
  const now = T0;
  eq("reminder: 8 days left, not yet", foundingReminderDue({ trialEndSec: now + 8 * DAY, nowSec: now, alreadySent: false }), false);
  eq("reminder: 7 days left, due", foundingReminderDue({ trialEndSec: now + 7 * DAY, nowSec: now, alreadySent: false }), true);
  eq("reminder: already sent", foundingReminderDue({ trialEndSec: now + 3 * DAY, nowSec: now, alreadySent: true }), false);
  eq("reminder: already ended", foundingReminderDue({ trialEndSec: now - 60, nowSec: now, alreadySent: false }), false);
  const r = foundingReminderEmail({ trialEndSec: Date.UTC(2026, 10, 30, 17) / 1000, timeZone: "America/Toronto" });
  eq("reminder subject", r.subject, "Your founding free time ends Monday, November 30");
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
