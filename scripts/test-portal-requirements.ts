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

const rentfaster = portalRequirementsFor("rentfaster");
ok("RentFaster is paid self serve", rentfaster?.automationMode === "paid_self_serve");
ok("RentFaster requires payment", requiredFieldsFor("rentfaster").includes("payment"));
ok("RentFaster requires phone", requiredFieldsFor("rentfaster").includes("contact_phone"));
ok("RentFaster can carry floorplans", rentfaster?.optional.includes("floorplans") === true);
ok(
  "RentFaster operator steps mention new-user review",
  rentfaster?.operatorSteps.some((step) => /review/i.test(step)) === true,
);

const zumper = portalRequirementsFor("zumper");
ok("Zumper is a feed candidate", zumper?.automationMode === "feed_candidate");
ok("Zumper requires phone", requiredFieldsFor("zumper").includes("contact_phone"));
ok("Zumper includes PadMapper proof language", /PadMapper/.test(zumper?.liveProofLabel ?? ""));
ok("Zumper carries premium top-ups", zumper?.topUps.includes("Premium listing plan") === true);

const viewit = portalRequirementsFor("viewit");
ok("Viewit is paid", viewit?.defaultTier === "top_up");
ok("Viewit requires payment", requiredFieldsFor("viewit").includes("payment"));
ok(
  "Viewit carries edit-link workflow",
  viewit?.operatorSteps.join(" ").includes("activation email") === true,
);

const realtor = portalRequirementsFor("realtor_ca");
ok("Realtor.ca is broker tier", realtor?.defaultTier === "broker");
ok("Realtor.ca requires broker route", requiredFieldsFor("realtor_ca").includes("broker_route"));
ok("Realtor.ca has no paid top-ups", realtor?.topUps.length === 0);

const facebook = portalRequirementsFor("facebook");
ok("Marketplace is not sourced as official yet", facebook?.sourceLevel === "operator_assertion");
ok("Marketplace is separate from Page feed", portalRequirementsFor("facebook_feed")?.automationMode === "api_post");
ok(
  "Marketplace source refs show verification target",
  facebook?.sourceRefs.some((ref) => ref.includes("facebook.com/help")) === true,
);

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

console.log(`portal-requirements: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
