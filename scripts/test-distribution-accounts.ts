// Unit tests for the pure distribution capability + account-readiness + attempt
// model (S480). Run: npx tsx scripts/test-distribution-accounts.ts
import {
  channelCapability,
  allChannelCapabilities,
  channelAccountReadiness,
  channelReadinessLabel,
} from "@/lib/distribution-capabilities";
import {
  actorTypeForTransport,
  nextAttemptNo,
  buildAttemptRecord,
} from "@/lib/distribution-attempts";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(c: boolean, msg: string): void {
  if (c) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}

// --- capability matrix ------------------------------------------------------
eq(channelCapability("vacantless").transport, "automatic", "vacantless is automatic");
eq(channelCapability("vacantless").postingPolicy, "automatic_allowed", "vacantless automatic_allowed");
eq(channelCapability("org_feed").supportsFeed, true, "org_feed supports feed");
eq(channelCapability("facebook").transport, "browser_copilot", "facebook is co-pilot");
eq(channelCapability("facebook").requiresLogin, true, "facebook needs login");
eq(channelCapability("facebook").postingPolicy, "human_confirmed", "facebook human_confirmed (no silent post)");
eq(channelCapability("kijiji").transport, "browser_copilot", "kijiji is co-pilot");
eq(channelCapability("linkedin").transport, "browser_copilot", "linkedin is co-pilot");
eq(channelCapability("instagram").requiresLogin, true, "instagram needs login");
eq(channelCapability("facebook_feed").postingPolicy, "human_confirmed", "facebook feed human confirmed");
eq(channelCapability("whatsapp").supportsConcierge, true, "whatsapp supports concierge");
eq(channelCapability("snapchat").supportsCopilot, true, "snapchat supports co-pilot");
eq(channelCapability("viewit").requiresPayment, true, "viewit needs payment");
eq(channelCapability("rentals_ca").transport, "feed_partner", "rentals_ca feed_partner");
eq(channelCapability("rentals_ca").needsOrgAccount, false, "rentals_ca is guided unless partner acceptance exists");
eq(channelCapability("rentfaster").transport, "feed_partner", "rentfaster feed candidate");
eq(channelCapability("rentfaster").requiresPayment, true, "rentfaster needs payment");
eq(channelCapability("rentfaster").postingPolicy, "human_confirmed", "rentfaster human confirmed");
eq(channelCapability("realtor_ca").transport, "broker", "realtor_ca broker");
eq(channelCapability("realtor_ca").postingPolicy, "broker_only", "realtor_ca broker_only");
eq(channelCapability("other").transport, "custom", "other custom");
eq(allChannelCapabilities().length, 16, "16 channel capabilities");

// --- account readiness ------------------------------------------------------
{
  // Automatic surfaces are always ready, no account.
  const r = channelAccountReadiness({ capability: channelCapability("vacantless") });
  eq(r.status, "ready", "vacantless ready");
  eq(r.nextActionKind, "publish_now", "vacantless publish_now");
}
{
  // Rentals.ca is a feed-candidate, but the default operator lane is guided.
  const r = channelAccountReadiness({ capability: channelCapability("rentals_ca"), accountStatus: null });
  eq(r.status, "ready", "rentals_ca no account => guided ready");
  eq(r.nextActionLabel, "Use guided posting", "rentals_ca guided next step");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("rentals_ca"), accountStatus: "submitted" });
  eq(r.status, "ready", "rentals_ca submitted account does not imply connected feed");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("rentals_ca"), accountStatus: "accepted" });
  eq(r.status, "ready", "rentals_ca accepted => ready");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("rentfaster") });
  eq(r.status, "ready", "rentfaster ready to guide");
  eq(r.nextActionLabel, "Use guided posting", "rentfaster guided next step");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("zumper"), hasFeedRoute: true });
  eq(r.status, "ready", "zumper with feed route => ready");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("rentals_ca"), accountStatus: "rejected" });
  eq(r.status, "rejected", "rejected surfaces");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("facebook"), accountStatus: "paused" });
  eq(r.status, "paused", "paused surfaces on any channel");
}
{
  // Co-pilot channels are ready to attempt (login happens live).
  const r = channelAccountReadiness({ capability: channelCapability("facebook") });
  eq(r.status, "ready", "facebook ready to co-pilot");
  eq(r.nextActionKind, "open_copilot", "facebook open_copilot");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("instagram") });
  eq(r.status, "ready", "instagram ready to co-pilot");
  eq(r.nextActionKind, "open_copilot", "instagram open_copilot");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("viewit"), accountStatus: "needs_payment" });
  eq(r.status, "needs_payment", "viewit needs_payment surfaces");
}
{
  const r = channelAccountReadiness({ capability: channelCapability("realtor_ca") });
  eq(r.status, "ready", "realtor_ca ready");
  eq(r.nextActionKind, "broker_handoff", "realtor_ca broker_handoff");
}
eq(channelReadinessLabel("needs_setup"), "Needs setup", "readiness label");

// --- attempts ---------------------------------------------------------------
eq(nextAttemptNo(0), 1, "first attempt = 1");
eq(nextAttemptNo(3), 4, "next after 3 = 4");
eq(nextAttemptNo(null), 1, "null count => 1");
eq(actorTypeForTransport("concierge"), "concierge", "concierge actor");
eq(actorTypeForTransport("browser_copilot"), "browser_copilot", "copilot actor");
eq(actorTypeForTransport("broker"), "broker", "broker actor");
eq(actorTypeForTransport("automatic"), "operator", "automatic => operator actor");
{
  const rec = buildAttemptRecord({
    organizationId: "org1",
    runId: "run1",
    runItemId: "item1",
    channel: "facebook",
    transport: "browser_copilot",
    currentAttemptCount: 1,
    actorType: "operator",
    statusAfter: "needs_login",
  });
  eq(rec.attempt_no, 2, "attempt_no from current count");
  eq(rec.status_after, "needs_login", "status_after carried");
  eq(rec.proof_id, null, "no proof id default");
  eq(rec.metadata, {}, "metadata default {}");
}

console.log(`test-distribution-accounts: ${pass}/${fail}`);
if (fail > 0) process.exit(1);
