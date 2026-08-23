// Unit tests for the source-owned portal requirement matrix.
// Run: npx tsx scripts/test-portal-requirements.ts

import { DISTRIBUTION_CHANNELS } from "../lib/distribution-channels";
import { PORTAL_KEYS } from "../lib/listing-distribution";
import {
  PORTAL_AUTOMATION_MODES,
  PORTAL_DISTRIBUTION_TIERS,
  PORTAL_OPERATOR_FIELD_KEYS,
  PORTAL_REQUIREMENT_FIELD_KEYS,
  PORTAL_REQUIREMENT_SOURCE_LEVELS,
  PORTAL_REQUIREMENTS,
  buildOneListingPacketRequirements,
  isPortalOperatorField,
  portalRequirementActionPlanFor,
  portalRequirementActionPlansFor,
  portalRequirementActionsFor,
  portalRequirementFieldLabel,
  portalRequirementsFor,
  recommendedFieldsFor,
  requiredFieldsFor,
} from "../lib/portal-requirements";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function actionLabelsFor(channel: string): string[] {
  return portalRequirementActionsFor(channel).map((action) => action.label);
}

function actionKindsFor(channel: string): string[] {
  return portalRequirementActionsFor(channel).map((action) => action.kind);
}

const requirementKeys = PORTAL_REQUIREMENTS.map((row) => row.channel);
const requirementKeySet = new Set(requirementKeys);
const channelKeys = DISTRIBUTION_CHANNELS.map((channel) => channel.key);

ok("one requirements row per distribution channel", requirementKeys.length === 12);
ok("requirements rows have no duplicates", requirementKeySet.size === requirementKeys.length);
for (const key of PORTAL_KEYS.filter((key) => key !== "other")) {
  ok(`requirements cover portal key ${key}`, requirementKeySet.has(key));
}
for (const key of channelKeys) {
  ok(`requirements cover distribution channel ${key}`, requirementKeySet.has(key));
}
ok("other has no requirements row", portalRequirementsFor("other") === null);
ok("unknown has no requirements row", portalRequirementsFor("not_real") === null);

const fieldKeySet = new Set(PORTAL_REQUIREMENT_FIELD_KEYS);
for (const row of PORTAL_REQUIREMENTS) {
  ok(`${row.channel}: tier is valid`, PORTAL_DISTRIBUTION_TIERS.includes(row.defaultTier));
  ok(`${row.channel}: mode is valid`, PORTAL_AUTOMATION_MODES.includes(row.automationMode));
  ok(
    `${row.channel}: source level is valid`,
    PORTAL_REQUIREMENT_SOURCE_LEVELS.includes(row.sourceLevel),
  );
  ok(`${row.channel}: has source refs`, row.sourceRefs.length > 0);
  ok(`${row.channel}: has proof label`, row.liveProofLabel.length > 8);
  ok(`${row.channel}: has operator guidance`, row.operatorSteps.length > 0);
  ok(`${row.channel}: no em dash in operator guidance`, !/[—–]/.test(row.operatorSteps.join(" ")));
  for (const field of [...row.required, ...row.recommended, ...row.optional]) {
    ok(`${row.channel}: field ${field} is known`, fieldKeySet.has(field));
    ok(`${row.channel}: field ${field} has label`, portalRequirementFieldLabel(field).length > 0);
  }
}

ok("operator field helper recognizes payment", isPortalOperatorField("payment"));
ok("operator field helper excludes rent", !isPortalOperatorField("rent"));
for (const field of PORTAL_OPERATOR_FIELD_KEYS) {
  ok(`operator field ${field} is a known field`, fieldKeySet.has(field));
}

const rentals = portalRequirementsFor("rentals_ca");
ok("Rentals.ca row resolves", rentals?.label === "Rentals.ca");
ok(
  "Rentals.ca required source fields",
  ["rent", "photos", "property_type"].every((field) =>
    requiredFieldsFor("rentals_ca").includes(field as never),
  ),
);
ok(
  "Rentals.ca keeps description and phone recommended",
  ["description", "contact_phone"].every((field) =>
    recommendedFieldsFor("rentals_ca").includes(field as never),
  ),
);
ok("Rentals.ca exposes top-up plans", rentals?.topUps.join("|") === "Promoted listing|Featured listing");
const rentalsActionPlan = portalRequirementActionPlanFor("rentals_ca");
ok("Rentals.ca primary action confirms feed route", rentalsActionPlan?.primaryActionLabel === "Confirm feed route");
ok("Rentals.ca action plan requires feed route", rentalsActionPlan?.requiresFeedRoute === true);
ok("Rentals.ca actions keep proof explicit", actionLabelsFor("rentals_ca").includes("Save live proof"));

const rentfaster = portalRequirementsFor("rentfaster");
ok("RentFaster is paid self serve", rentfaster?.automationMode === "paid_self_serve");
ok("RentFaster requires payment", requiredFieldsFor("rentfaster").includes("payment"));
ok("RentFaster requires phone", requiredFieldsFor("rentfaster").includes("contact_phone"));
ok("RentFaster can carry floorplans", rentfaster?.optional.includes("floorplans") === true);
ok(
  "RentFaster operator steps mention new-user review",
  rentfaster?.operatorSteps.some((step) => /review/i.test(step)) === true,
);
const rentfasterActions = actionLabelsFor("rentfaster");
ok("RentFaster actions include sign in", rentfasterActions.includes("Sign in"));
ok("RentFaster actions include payment approval", rentfasterActions.includes("Approve payment"));
ok("RentFaster actions include paid posting assist", rentfasterActions.includes("Use paid posting assist"));
ok("RentFaster actions include proof", rentfasterActions.includes("Save live proof"));
ok(
  "RentFaster primary action highlights paid gate",
  portalRequirementActionPlanFor("rentfaster")?.primaryActionLabel === "Approve payment",
);

const zumper = portalRequirementsFor("zumper");
ok("Zumper is a feed candidate", zumper?.automationMode === "feed_candidate");
ok("Zumper requires phone", requiredFieldsFor("zumper").includes("contact_phone"));
ok("Zumper includes PadMapper proof language", /PadMapper/.test(zumper?.liveProofLabel ?? ""));
ok("Zumper carries premium top-ups", zumper?.topUps.includes("Premium listing plan") === true);
ok("Zumper actions include feed route", actionLabelsFor("zumper").includes("Confirm feed route"));
ok("Zumper actions include proof", actionLabelsFor("zumper").includes("Save live proof"));

const viewit = portalRequirementsFor("viewit");
ok("Viewit is paid", viewit?.defaultTier === "top_up");
ok("Viewit requires payment", requiredFieldsFor("viewit").includes("payment"));
ok(
  "Viewit carries edit-link workflow",
  viewit?.operatorSteps.join(" ").includes("activation email") === true,
);
ok("Viewit action plan requires payment", portalRequirementActionPlanFor("viewit")?.requiresPayment === true);
ok("Viewit primary action is payment", portalRequirementActionPlanFor("viewit")?.primaryActionLabel === "Approve payment");

const realtor = portalRequirementsFor("realtor_ca");
ok("Realtor.ca is broker tier", realtor?.defaultTier === "broker");
ok("Realtor.ca requires broker route", requiredFieldsFor("realtor_ca").includes("broker_route"));
ok("Realtor.ca has no paid top-ups", realtor?.topUps.length === 0);
ok("Realtor.ca primary action is broker handoff", portalRequirementActionPlanFor("realtor_ca")?.primaryActionLabel === "Create broker handoff");
ok("Realtor.ca action plan keeps broker flag", portalRequirementActionPlanFor("realtor_ca")?.requiresBroker === true);

const facebook = portalRequirementsFor("facebook");
ok("Marketplace is not sourced as official yet", facebook?.sourceLevel === "operator_assertion");
ok("Marketplace is separate from Page feed", portalRequirementsFor("facebook_feed")?.automationMode === "api_post");
ok(
  "Marketplace source refs show verification target",
  facebook?.sourceRefs.some((ref) => ref.includes("facebook.com/help")) === true,
);
ok("Marketplace primary action is posting assist", portalRequirementActionPlanFor("facebook")?.primaryActionLabel === "Use posting assist");
ok("Kijiji primary action is posting assist", portalRequirementActionPlanFor("kijiji")?.primaryActionLabel === "Use posting assist");

const facebookFeedActions = actionLabelsFor("facebook_feed");
ok("Facebook Page feed actions authorize account", facebookFeedActions.includes("Authorize account"));
ok("Facebook Page feed actions approve API post", facebookFeedActions.includes("Approve API post"));
ok("Facebook Page feed primary action is API approval", portalRequirementActionPlanFor("facebook_feed")?.primaryActionLabel === "Approve API post");
ok("Instagram actions approve API post", actionLabelsFor("instagram").includes("Approve API post"));

const whatsappActions = actionLabelsFor("whatsapp");
ok("WhatsApp actions choose audience", whatsappActions.includes("Choose audience"));
ok("WhatsApp actions share message", whatsappActions.includes("Share message"));
ok("WhatsApp primary action is share message", portalRequirementActionPlanFor("whatsapp")?.primaryActionLabel === "Share message");
ok("LinkedIn actions sign in", actionLabelsFor("linkedin").includes("Sign in"));
ok("Snapchat actions share message", actionLabelsFor("snapchat").includes("Share message"));

const socialPacket = buildOneListingPacketRequirements([
  "facebook_feed",
  "instagram",
  "linkedin",
]);
ok("social packet includes tracked link", socialPacket.listingFields.includes("tracked_link"));
ok("social packet keeps account login as operator field", socialPacket.operatorFields.includes("account_login"));
ok("social packet requires photos", socialPacket.requiredListingFields.includes("photos"));

const portalPacket = buildOneListingPacketRequirements([
  "kijiji",
  "rentals_ca",
  "rentfaster",
  "zumper",
  "viewit",
]);
ok("portal packet includes rent", portalPacket.requiredListingFields.includes("rent"));
ok("portal packet includes photos", portalPacket.listingFields.includes("photos"));
ok("portal packet includes contact phone", portalPacket.listingFields.includes("contact_phone"));
ok("portal packet separates payment from listing fields", !portalPacket.listingFields.includes("payment"));
ok("portal packet separates proof URL from listing fields", !portalPacket.listingFields.includes("proof_url"));
ok("portal packet keeps payment as operator field", portalPacket.operatorFields.includes("payment"));
ok("portal packet keeps proof URL as operator field", portalPacket.operatorFields.includes("proof_url"));
ok("portal packet carries top-ups", portalPacket.topUps.length >= 6);
ok(
  "portal packet has proof requirement for every selected outside site",
  portalPacket.proofRequiredChannels.length === 5,
);

const allPacket = buildOneListingPacketRequirements();
ok("default packet covers every channel", allPacket.channels.length === 12);
ok("default packet includes broker proof gate", allPacket.operatorFields.includes("broker_route"));
ok("default packet labels multiple source levels", allPacket.sourceLevels.length >= 3);

const allActionPlans = portalRequirementActionPlansFor();
ok("action plans cover every requirements row", allActionPlans.length === PORTAL_REQUIREMENTS.length);
ok("other has no requirement actions", portalRequirementActionsFor("other").length === 0);
ok("unknown has no requirement action plan", portalRequirementActionPlanFor("not_real") === null);
for (const row of PORTAL_REQUIREMENTS) {
  const plan = portalRequirementActionPlanFor(row.channel);
  ok(`${row.channel}: action plan resolves`, plan?.channel === row.channel);
  ok(`${row.channel}: action plan has a primary action`, Boolean(plan?.primaryAction));
  ok(
    `${row.channel}: action text has no em dash`,
    !/[—–]/.test(
      portalRequirementActionsFor(row.channel)
        .map((action) => `${action.label} ${action.detail}`)
        .join(" "),
    ),
  );
  if (row.proofRequired) {
    ok(
      `${row.channel}: proof-required channel saves live proof`,
      actionKindsFor(row.channel).includes("save_live_proof"),
    );
  }
}

console.log(`portal-requirements: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
