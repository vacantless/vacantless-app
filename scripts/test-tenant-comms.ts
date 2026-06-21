// Unit tests for the pure tenant-comms domain model.
// Run: npx tsx scripts/test-tenant-comms.ts
import {
  MESSAGE_CHANNELS,
  channelLabel,
  isMessageChannel,
  channelIncludesEmail,
  channelIncludesSms,
  deliveryChannelsFor,
  applyMessageTokens,
  firstNameOf,
  formatRentForToken,
  tokenVarsFor,
  renderForRecipient,
  validateTemplateInput,
  validateMessageInput,
  commsErrorMessage,
  planDeliveries,
  applySmsEntitlement,
  isSendable,
  tallyDeliveries,
  buildTenantSmsBody,
  hasOptOutInstruction,
  type TenantContact,
} from "../lib/tenant-comms";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Channels ---------------------------------------------------------------
ok("channels are email/sms/both", MESSAGE_CHANNELS.join(",") === "email,sms,both");
ok("isMessageChannel accepts known", MESSAGE_CHANNELS.every((c) => isMessageChannel(c)));
ok("isMessageChannel rejects unknown", !isMessageChannel("whatsapp"));
ok("label email", channelLabel("email") === "Email");
ok("label both", channelLabel("both") === "Email + Text");
ok("label unknown passthrough", channelLabel("zzz") === "zzz");

ok("email includes email", channelIncludesEmail("email"));
ok("both includes email", channelIncludesEmail("both"));
ok("sms excludes email", !channelIncludesEmail("sms"));
ok("sms includes sms", channelIncludesSms("sms"));
ok("both includes sms", channelIncludesSms("both"));
ok("email excludes sms", !channelIncludesSms("email"));

ok("deliveryChannelsFor email", deliveryChannelsFor("email").join(",") === "email");
ok("deliveryChannelsFor sms", deliveryChannelsFor("sms").join(",") === "sms");
ok("deliveryChannelsFor both", deliveryChannelsFor("both").join(",") === "email,sms");

// --- Token substitution -----------------------------------------------------
ok("token basic", applyMessageTokens("Hi {{first_name}}", { first_name: "Sam" }) === "Hi Sam");
ok("token spaces", applyMessageTokens("Hi {{ first_name }}", { first_name: "Sam" }) === "Hi Sam");
ok("token case-insensitive", applyMessageTokens("Hi {{First_Name}}", { first_name: "Sam" }) === "Hi Sam");
ok("token unknown left as-is", applyMessageTokens("Hi {{mystery}}", { first_name: "Sam" }) === "Hi {{mystery}}");
ok("token multiple", applyMessageTokens("{{org_name}} - {{property_address}}", { org_name: "Acme", property_address: "1 King St" }) === "Acme - 1 King St");

ok("firstNameOf full name", firstNameOf("Sam Lee") === "Sam");
ok("firstNameOf null -> there", firstNameOf(null) === "there");
ok("firstNameOf blank -> there", firstNameOf("   ") === "there");

ok("rent token formats", formatRentForToken(125000) === "$1,250/month");
ok("rent token null -> empty", formatRentForToken(null) === "");

const vars = tokenVarsFor({
  tenantName: "Sam Lee",
  orgName: "Acme Rentals",
  propertyAddress: "1 King St",
  rentCents: 125000,
});
ok("tokenVars first_name", vars.first_name === "Sam");
ok("tokenVars full_name", vars.full_name === "Sam Lee");
ok("tokenVars property", vars.property_address === "1 King St");
ok("tokenVars org", vars.org_name === "Acme Rentals");
ok("tokenVars rent", vars.rent === "$1,250/month");

const varsContact = tokenVarsFor({
  tenantName: "Sam Lee",
  orgName: "Acme Rentals",
  propertyAddress: "1 King St",
  rentCents: 125000,
  orgContactEmail: "  hello@acme.ca ",
  orgContactPhone: "226-773-7555",
});
ok("tokenVars business_email trimmed", varsContact.business_email === "hello@acme.ca");
ok("tokenVars business_phone", varsContact.business_phone === "226-773-7555");

const varsEmpty = tokenVarsFor({ tenantName: null, orgName: null, propertyAddress: null, rentCents: null });
ok("tokenVars fallback first_name", varsEmpty.first_name === "there");
ok("tokenVars fallback full_name", varsEmpty.full_name === "there");
ok("tokenVars fallback property", varsEmpty.property_address === "your home");
ok("tokenVars fallback org", varsEmpty.org_name === "your property manager");
ok("tokenVars fallback rent empty", varsEmpty.rent === "");
ok("tokenVars business_email empty when unset", varsEmpty.business_email === "");
ok("tokenVars business_phone empty when unset", varsEmpty.business_phone === "");

ok(
  "renderForRecipient with contact tokens",
  renderForRecipient("Questions? Email {{business_email}} or call {{business_phone}}.", {
    tenantName: "Sam Lee",
    orgName: "Acme",
    propertyAddress: "1 King St",
    rentCents: 125000,
    orgContactEmail: "hello@acme.ca",
    orgContactPhone: "226-773-7555",
  }) === "Questions? Email hello@acme.ca or call 226-773-7555.",
);

ok(
  "renderForRecipient end to end",
  renderForRecipient("Hi {{first_name}}, rent for {{property_address}} is {{rent}}.", {
    tenantName: "Sam Lee",
    orgName: "Acme",
    propertyAddress: "1 King St",
    rentCents: 125000,
  }) === "Hi Sam, rent for 1 King St is $1,250/month.",
);

// --- validateTemplateInput --------------------------------------------------
{
  const r = validateTemplateInput({ name: "Rent due", channel: "email", subject: "Rent reminder", body: "Hi {{first_name}}" });
  ok("template email ok", r.ok === true && r.value.channel === "email" && r.value.subject === "Rent reminder");
}
{
  const r = validateTemplateInput({ name: "Maint", channel: "sms", subject: "ignored", body: "Plumber tomorrow" });
  ok("template sms drops subject", r.ok === true && r.value.subject === null);
}
{
  const r = validateTemplateInput({ name: "Both", channel: "both", subject: "Hello", body: "Hi" });
  ok("template both keeps subject", r.ok === true && r.value.subject === "Hello");
}
ok("template missing name", validateTemplateInput({ name: "  ", channel: "email", subject: "s", body: "b" }).ok === false);
ok("template bad channel", validateTemplateInput({ name: "n", channel: "fax", subject: "s", body: "b" }).ok === false);
ok("template missing body", validateTemplateInput({ name: "n", channel: "email", subject: "s", body: "  " }).ok === false);
{
  const r = validateTemplateInput({ name: "n", channel: "email", subject: "  ", body: "b" });
  ok("template email needs subject", r.ok === false && r.code === "subject");
}
{
  const r = validateTemplateInput({ name: "n", channel: "sms", subject: "", body: "b" });
  ok("template sms no subject needed", r.ok === true);
}

// --- validateMessageInput ---------------------------------------------------
{
  const r = validateMessageInput({ channel: "email", subject: "Hi", body: "Body", recipientCount: 2 });
  ok("message email ok", r.ok === true && r.value.subject === "Hi");
}
{
  const r = validateMessageInput({ channel: "sms", subject: null, body: "Body", recipientCount: 1 });
  ok("message sms ok, subject null", r.ok === true && r.value.subject === null);
}
ok("message bad channel", validateMessageInput({ channel: "x", subject: "s", body: "b", recipientCount: 1 }).ok === false);
ok("message empty body", validateMessageInput({ channel: "email", subject: "s", body: " ", recipientCount: 1 }).ok === false);
{
  const r = validateMessageInput({ channel: "email", subject: "s", body: "b", recipientCount: 0 });
  ok("message no recipients", r.ok === false && r.code === "recipients");
}
{
  const r = validateMessageInput({ channel: "email", subject: "", body: "b", recipientCount: 1 });
  ok("message email needs subject", r.ok === false && r.code === "subject");
}

ok("error message known", commsErrorMessage("recipients") === "Pick at least one tenant to message.");
ok("error message null", commsErrorMessage(undefined) === null);
ok("error message unknown fallback", commsErrorMessage("weird")!.length > 0);

// --- planDeliveries ---------------------------------------------------------
const tenants: TenantContact[] = [
  { id: "a", name: "Sam Lee", email: "sam@example.com", phone: "519-555-1234", sms_opt_out: false },
  { id: "b", name: "Jo Park", email: null, phone: "5195559999", sms_opt_out: false },
  { id: "c", name: "Kit No-Phone", email: "kit@example.com", phone: null, sms_opt_out: false },
  { id: "d", name: "Opted Out", email: "d@example.com", phone: "5195550000", sms_opt_out: true },
];
const allIds = new Set(["a", "b", "c", "d"]);

{
  const plan = planDeliveries("email", tenants, allIds);
  ok("email plan one per tenant", plan.length === 4);
  ok("email a sendable", isSendable(plan.find((p) => p.tenantId === "a")!));
  ok("email b skip no_email", plan.find((p) => p.tenantId === "b")!.skipReason === "no_email");
  ok("email destination normalized? (raw email kept)", plan.find((p) => p.tenantId === "a")!.destination === "sam@example.com");
}
{
  const plan = planDeliveries("sms", tenants, allIds);
  ok("sms plan one per tenant", plan.length === 4);
  ok("sms a sendable + E164", plan.find((p) => p.tenantId === "a")!.destination === "+15195551234");
  ok("sms c skip no_phone", plan.find((p) => p.tenantId === "c")!.skipReason === "no_phone");
  ok("sms d opted out", plan.find((p) => p.tenantId === "d")!.skipReason === "opted_out");
}
{
  const plan = planDeliveries("both", tenants, new Set(["a"]));
  ok("both fans out to 2 deliveries for one tenant", plan.length === 2);
  ok("both has email + sms", plan.map((p) => p.channel).sort().join(",") === "email,sms");
}
{
  const plan = planDeliveries("email", tenants, new Set(["a"]));
  ok("only selected tenants planned", plan.length === 1 && plan[0].tenantId === "a");
}

// --- applySmsEntitlement (S214 plan gate) -----------------------------------
{
  // smsAllowed = true -> plan is returned unchanged (same reference).
  const plan = planDeliveries("both", tenants, allIds);
  ok("entitlement allowed: unchanged reference", applySmsEntitlement(plan, true) === plan);
}
{
  // smsAllowed = false -> every sms delivery becomes not_on_plan; email untouched.
  const plan = planDeliveries("both", tenants, allIds);
  const gated = applySmsEntitlement(plan, false);
  const smsLegs = gated.filter((d) => d.channel === "sms");
  const emailLegs = gated.filter((d) => d.channel === "email");
  ok("gated: all sms legs not_on_plan", smsLegs.every((d) => d.skipReason === "not_on_plan"));
  ok("gated: no sms leg sendable", smsLegs.every((d) => !isSendable(d)));
  ok(
    "gated: email legs preserved (a sendable, b/c/d per their own reason)",
    isSendable(emailLegs.find((d) => d.tenantId === "a")!),
  );
  ok(
    "gated: not_on_plan OVERRIDES opted_out on the same tenant",
    gated.find((d) => d.tenantId === "d" && d.channel === "sms")!.skipReason === "not_on_plan",
  );
}
{
  // sms-only plan with the gate off -> nothing sendable (the action redirects
  // sms_locked before logging, but the pure gate still neutralizes the legs).
  const plan = planDeliveries("sms", tenants, allIds);
  const gated = applySmsEntitlement(plan, false);
  ok("gated sms-only: zero sendable", gated.every((d) => !isSendable(d)));
}

// --- tallyDeliveries --------------------------------------------------------
{
  const plan = planDeliveries("both", tenants, allIds);
  const tally = tallyDeliveries(plan);
  // 4 tenants, 8 deliveries. Sendable: a(email+sms)=2, b(sms)=1, c(email)=1, d(email)=1 => 5. Skipped: 3.
  ok("tally recipientCount distinct tenants", tally.recipientCount === 4);
  ok("tally sendable count", tally.sendable === 5);
  ok("tally skipped count", tally.skipped === 3);
  ok("tally sendable+skipped = total", tally.sendable + tally.skipped === plan.length);
}

// --- buildTenantSmsBody -----------------------------------------------------
ok(
  "sms body prefixes org + adds opt-out",
  buildTenantSmsBody("Plumber comes tomorrow 9am.", "Acme") ===
    "Acme: Plumber comes tomorrow 9am. Reply STOP to opt out.",
);
ok(
  "sms body no org prefix when blank",
  buildTenantSmsBody("Plumber tomorrow.", null) === "Plumber tomorrow. Reply STOP to opt out.",
);
ok(
  "sms body doesn't double opt-out",
  buildTenantSmsBody("Reply STOP to opt out anytime.", "Acme") === "Acme: Reply STOP to opt out anytime.",
);
ok(
  "sms body strips em dash",
  !buildTenantSmsBody("Rent is due - pay soon", "Acme").includes("—"),
);

// Regression: the opt-out line must NOT be dropped just because the bare word
// "stop" appears innocently in the org name or the body. Only an actual opt-out
// INSTRUCTION ("reply/text STOP", "STOP to opt out/unsubscribe/...") suppresses
// the appended line. (Was a /\bSTOP\b/ false-positive that silently removed the
// required compliance copy.)
ok(
  "sms body keeps opt-out when org name contains 'stop'",
  buildTenantSmsBody("Plumber comes tomorrow 9am.", "One-Stop Rentals") ===
    "One-Stop Rentals: Plumber comes tomorrow 9am. Reply STOP to opt out.",
);
ok(
  "sms body keeps opt-out when body says 'stop by'",
  buildTenantSmsBody("Please stop by the office to pick up keys.", "Acme") ===
    "Acme: Please stop by the office to pick up keys. Reply STOP to opt out.",
);
ok(
  "sms body suppresses dup on 'Text STOP to unsubscribe'",
  buildTenantSmsBody("Text STOP to unsubscribe.", "Acme") ===
    "Acme: Text STOP to unsubscribe.",
);
ok(
  "sms body suppresses dup on 'STOP to cancel'",
  buildTenantSmsBody("Reminder. STOP to cancel.", "Acme") ===
    "Acme: Reminder. STOP to cancel.",
);

// hasOptOutInstruction unit coverage
ok("optout detect: reply STOP", hasOptOutInstruction("Reply STOP to opt out."));
ok("optout detect: text stop", hasOptOutInstruction("text stop anytime"));
ok("optout detect: STOP to unsubscribe", hasOptOutInstruction("STOP to unsubscribe"));
ok("optout NOT: one-stop", !hasOptOutInstruction("One-Stop Rentals"));
ok("optout NOT: stop by", !hasOptOutInstruction("please stop by the office"));
ok("optout NOT: bare stop word", !hasOptOutInstruction("we will stop the elevator service"));

// ----------------------------------------------------------------------------
console.log(`tenant-comms: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
