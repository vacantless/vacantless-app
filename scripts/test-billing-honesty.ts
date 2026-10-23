// S712 billing honesty: status-aware plan grant, texts on with Growth, the
// over-cap notice, and the copy/wiring fixes that keep the site's promises true.
// Run: npx tsx scripts/test-billing-honesty.ts
import { readFileSync } from "node:fs";
import {
  overListingCapNotice,
  planForSubscriptionEvent,
  shouldEnableSmsOnPlanChange,
  subscriptionGrantsPlan,
} from "../lib/billing";
import { buildLaunchChecklist, type ChecklistInput } from "../lib/onboarding";
import {
  isDripEnqueueEnabled,
  isOutcomeNudgeEnabled,
  getNotificationEvent,
  type NotificationSettingRow,
} from "../lib/notifications";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- 3. Status-aware plan helper ------------------------------------------
ok("active grants", subscriptionGrantsPlan("active"));
ok("trialing grants", subscriptionGrantsPlan("trialing"));
ok("past_due grants (grace)", subscriptionGrantsPlan("past_due"));
for (const st of ["incomplete", "incomplete_expired", "unpaid", "canceled", "paused", null]) {
  ok(`${st} does not grant`, !subscriptionGrantsPlan(st));
}
const base = {
  tier: "growth" as const,
  statusApplies: true,
  existingPlan: "free",
  sameSubscription: true,
  existingSubscriptionId: "sub_1",
};
ok("active -> growth", planForSubscriptionEvent({ ...base, status: "active" }) === "growth");
ok("trialing -> growth", planForSubscriptionEvent({ ...base, status: "trialing" }) === "growth");
ok("incomplete on free -> leave", planForSubscriptionEvent({ ...base, status: "incomplete" }) === null);
ok(
  "incomplete on pilot -> leave",
  planForSubscriptionEvent({ ...base, existingPlan: "pilot", status: "incomplete" }) === null,
);
ok(
  "unpaid on growth -> free",
  planForSubscriptionEvent({ ...base, existingPlan: "growth", status: "unpaid" }) === "free",
);
ok(
  "incomplete_expired on growth, no sub on record -> free",
  planForSubscriptionEvent({
    ...base,
    existingPlan: "growth",
    existingSubscriptionId: null,
    sameSubscription: false,
    status: "incomplete_expired",
  }) === "free",
);
ok(
  "incomplete NEW sub does not drop an org paid by another sub",
  planForSubscriptionEvent({
    ...base,
    existingPlan: "growth",
    existingSubscriptionId: "sub_old",
    sameSubscription: false,
    status: "incomplete",
  }) === null,
);
ok(
  "stale event (status not applied) -> leave",
  planForSubscriptionEvent({ ...base, statusApplies: false, existingPlan: "growth", status: "incomplete" }) === null,
);
ok(
  "unknown price on active -> leave",
  planForSubscriptionEvent({ ...base, tier: null, status: "active" }) === null,
);

// --- 2. Texts on when moving onto a texting plan --------------------------
ok("free -> growth enables texts", shouldEnableSmsOnPlanChange("free", "growth"));
ok("trial -> pilot enables texts", shouldEnableSmsOnPlanChange("trial", "pilot"));
ok("growth -> growth does not re-enable", !shouldEnableSmsOnPlanChange("growth", "growth"));
ok("growth -> free never enables", !shouldEnableSmsOnPlanChange("growth", "free"));
const webhook = read("app/api/stripe/webhook/route.ts");
ok("webhook uses planForSubscriptionEvent", webhook.includes("planForSubscriptionEvent({"));
ok(
  "webhook sets sms_enabled inside applySubscription on transition",
  /shouldEnableSmsOnPlanChange\(existing\.plan, nextPlan\)[\s\S]{0,80}update\.sms_enabled = true/.test(webhook),
);
ok("webhook no longer writes plan straight from the price", !webhook.includes("if (tier) update.plan = tier"));
ok(
  "pilot start also switches texts on",
  read("app/dashboard/billing/actions.ts").includes('shouldEnableSmsOnPlanChange(org.plan, "pilot")'),
);

// --- 4. Over-cap notice ----------------------------------------------------
ok(
  "free with 3 live -> notice",
  overListingCapNotice("free", 3) === "You have 3 live rentals. Free covers one. Upgrade or take some down.",
);
ok("free with 1 live -> none", overListingCapNotice("free", 1) === null);
ok("growth with 9 live -> none", overListingCapNotice("growth", 9) === null);
ok("pilot with 9 live -> none", overListingCapNotice("pilot", 9) === null);
ok("dashboard shows the notice", read("app/dashboard/page.tsx").includes("overListingCapNotice(org?.plan"));
ok("billing page shows the notice", read("app/dashboard/billing/page.tsx").includes("overListingCapNotice(org.plan"));

// --- 1. Outcome question on by default ------------------------------------
const row = (enabled: boolean): NotificationSettingRow =>
  ({ event_key: "leasing.showing_outcome_nudge", enabled }) as NotificationSettingRow;
ok("outcome nudge: absent row = on", isOutcomeNudgeEnabled(null));
ok("outcome nudge: explicit off = off", !isOutcomeNudgeEnabled(row(false)));
ok("outcome nudge: explicit on = on", isOutcomeNudgeEnabled(row(true)));
ok("other drips stay opt-in (absent row = off)", !isDripEnqueueEnabled(null));
const cron = read("app/api/cron/showing-outcome-nudge/route.ts");
ok("cron gates on isOutcomeNudgeEnabled", cron.includes("isOutcomeNudgeEnabled(setting)"));
ok("cron no longer gates on isDripEnqueueEnabled", !cron.includes("isDripEnqueueEnabled"));
const ev = getNotificationEvent("leasing.showing_outcome_nudge");
ok("automations copy no longer says off until on", !!ev && !ev.description.includes("Off until you turn it on"));
ok(
  "automations page shows an absent row as on",
  read("app/dashboard/automations/page.tsx").includes("row ? row.enabled : true"),
);

// --- 5. Go live completes on a live rental, any plan ----------------------
const EMPTY: ChecklistInput = {
  propertyCount: 0,
  listingOnlineCount: 0,
  wizardEnabled: false,
  availabilityWindowCount: 0,
  replyToConfigured: false,
  leadCount: 0,
  liveRentalCount: 0,
};
const golive = (n: number) =>
  buildLaunchChecklist({ ...EMPTY, liveRentalCount: n }).steps.find((s) => s.key === "golive");
ok("go live complete with one live rental", golive(1)?.status === "complete");
ok("go live not complete with none", golive(0)?.status !== "complete");
ok("dashboard passes liveRentalCount", read("app/dashboard/page.tsx").includes("liveRentalCount: liveRentalCount ?? 0"));

// --- 6. Homepage reminder copy --------------------------------------------
const home = read("app/page.tsx");
ok("homepage drops the wrong text-on-Growth line", !home.includes("plus a text on Growth"));
ok("homepage says the day-before reminder is email", home.includes("a reminder email the day before"));

// --- 7. Privacy providers ---------------------------------------------------
const privacy = read("app/privacy/page.tsx");
ok("privacy names Anthropic", privacy.includes("(Anthropic)"));
ok("privacy names Twilio (Quo retired S724)", privacy.includes("(Twilio)"));

// --- 8. Chexy plain link ----------------------------------------------------
const tenancy = read("app/dashboard/tenancies/[id]/page.tsx");
ok("chexy link has no fake ref", tenancy.includes('href="https://chexy.co/"') && !tenancy.includes("ref=vacantless"));
ok("chexy TODO about a partner code is gone", !/TODO[^\n]*Chexy partner code/.test(tenancy));

console.log(`\nbilling-honesty: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
