// S808: listing details (lib/listing-details) and the listing defaults merge
// (lib/policy-profile, migration 0303).
import {
  normalizeExposure, normalizeAppliances, normalizeFlooring, parseRenovatedYear, parseMaxOccupants,
  parseDollarsToCents, exposureLabel, renovatedLabel, appliancesLabel, maxOccupantsLabel, parkingFeeLabel, cleanText,
} from "../lib/listing-details";
import {
  resolveEffectiveFeatures, resolveBuildingProfile, parseListingDefaults, listingDefaultsAllInherit,
  validateBuildingPolicySettings, validatePolicyProfileSettings, policyProfileFromRow, readListingDefaultsForm,
} from "../lib/policy-profile";
import { buildGoodToKnow, buildAmenityChips } from "../lib/property-features";
import { listingFactsLine } from "../lib/listing-copy";
import { sisterFillPatch } from "../lib/sister-unit-fill";

let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) pass++; else { fail++; console.log("FAIL", n); } }
const now = new Date("2026-11-16T12:00:00Z");

ok("exposure order + junk", JSON.stringify(normalizeExposure(["west", "South", "up"])) === '["south","west"]');
ok("exposure from string", normalizeExposure("north,east").length === 2);
ok("appliances", JSON.stringify(normalizeAppliances(["dryer", "fridge", "toaster"])) === '["fridge","dryer"]');
ok("flooring", normalizeFlooring("Laminate") === "laminate" && normalizeFlooring("marble") === null);
ok("reno year", parseRenovatedYear("2024", now) === 2024 && parseRenovatedYear("2027", now) === null && parseRenovatedYear("abc", now) === null);
ok("max occupants", parseMaxOccupants("3") === 3 && parseMaxOccupants("0") === null && parseMaxOccupants("21") === null);
ok("dollars", parseDollarsToCents("$50") === 5000 && parseDollarsToCents("") === null && parseDollarsToCents("x") === null && parseDollarsToCents("0") === 0);
ok("exposure label one", exposureLabel(["south"]) === "South facing");
ok("exposure label two + view", exposureLabel(["south", "west"], "park view") === "South and west facing, park view");
ok("exposure label empty", exposureLabel([], " ") === null);
ok("reno label", renovatedLabel(2024) === "Renovated in 2024" && renovatedLabel(null) === null);
ok("appliances label", appliancesLabel(["fridge", "stove", "washer"]) === "Fridge, stove and washer");
ok("max label", maxOccupantsLabel(1) === "Up to 1 person" && maxOccupantsLabel(3) === "Up to 3 people");
ok("fee label", parkingFeeLabel(5000) === "$50 a month" && parkingFeeLabel(0) === "Included" && parkingFeeLabel(null) === null);
ok("clean text caps", cleanText("  a   b ", 120) === "a b" && cleanText("x".repeat(200), 120)!.length === 120);

// Defaults merge.
const org = policyProfileFromRow({
  policy_parking_type: "outdoor", policy_parking_count: 1, policy_parking_fee_cents: 5000,
  policy_laundry: "in_building", policy_heating_type: "boiler", policy_internet_included: false,
  policy_building_amenities: ["elevator", "storage_locker"], policy_nearby: "Close to Walkerville", policy_appliances: ["fridge", "stove"],
});
ok("row mapping", org!.parking_fee_cents === 5000 && org!.nearby === "Close to Walkerville");
const empty = resolveEffectiveFeatures({}, org).features;
ok("empty unit inherits parking pair + fee", empty.parking_type === "outdoor" && empty.parking_count === 1 && empty.parking_fee_cents === 5000);
ok("empty unit inherits laundry/heating/internet", empty.laundry === "in_building" && empty.heating_type === "boiler" && empty.internet_included === false);
ok("empty unit inherits nearby/appliances", empty.nearby === "Close to Walkerville" && empty.appliances!.length === 2);
ok("building amenities", JSON.stringify(empty.amenities) === '["elevator","storage_locker"]');
const own = resolveEffectiveFeatures({ parking_type: "garage", laundry: "in_suite", amenities: ["dishwasher"], nearby: "Near the river", appliances: ["washer"] }, org).features;
ok("unit parking wins, fee does not cross kinds", own.parking_type === "garage" && own.parking_count == null && own.parking_fee_cents == null);
ok("unit laundry/nearby/appliances win", own.laundry === "in_suite" && own.nearby === "Near the river" && own.appliances![0] === "washer");
ok("amenities union", JSON.stringify(own.amenities) === '["dishwasher","elevator","storage_locker"]');
const sameKind = resolveEffectiveFeatures({ parking_type: "outdoor", parking_count: 2 }, org).features;
ok("same kind takes the fee", sameKind.parking_count === 2 && sameKind.parking_fee_cents === 5000);
const none = resolveEffectiveFeatures({ parking_type: "none" }, org).features;
ok("no parking: no fee", none.parking_fee_cents == null);
const text = resolveEffectiveFeatures({ parking: "1 spot behind" }, org).features;
ok("free-text parking blocks the pair", text.parking_type == null);
const ownFee = resolveEffectiveFeatures({ parking_type: "garage", parking_fee_cents: 0 }, org).features;
ok("own zero fee kept", ownFee.parking_fee_cents === 0);
ok("no profile: unit untouched", resolveEffectiveFeatures({ laundry: "shared" }, null).features.laundry === "shared");

const bld = resolveBuildingProfile({ heating_type: "baseboard", building_amenities: ["gym"] }, org);
ok("building over org", bld.heating_type === "baseboard" && bld.laundry === "in_building" && bld.building_amenities![0] === "gym");

// Settings parse.
const parsed = parseListingDefaults({ parking_type: "outdoor", parking_count: "1", parking_fee: "$50", laundry: "in_building", heating_type: "boiler", internet_included: "false", building_amenities: ["elevator", "bogus"], nearby: " Close to Walkerville ", appliances: ["fridge"] });
ok("parse values", parsed.policy_parking_fee_cents === 5000 && parsed.policy_internet_included === false && parsed.policy_building_amenities!.length === 1 && parsed.policy_nearby === "Close to Walkerville");
ok("blank parse all inherit", listingDefaultsAllInherit(parseListingDefaults({})));
const fd = new FormData(); fd.append("policy_appliances", "fridge"); fd.append("policy_appliances", "stove"); fd.set("policy_nearby", "x");
ok("form read", readListingDefaultsForm(fd).appliances!.length === 2 && readListingDefaultsForm(fd).nearby === "x");
const baseForm = { lease_term: "", smoking: "", ac_type: "", on_site_management: "", heat_included: "", hydro_included: "", water_included: "", pets_cats: "", pets_dogs: "", pets_dog_size: "" };
ok("building: listing default alone is an override", validateBuildingPolicySettings({ ...baseForm, nearby: "Downtown" }).allInherit === false);
ok("building: nothing set = inherit", validateBuildingPolicySettings(baseForm).allInherit === true);
ok("org save carries listing defaults", validatePolicyProfileSettings({ ...baseForm, laundry: "shared" }).values.policy_laundry === "shared");

// Surfaces.
const facts = buildGoodToKnow({ ...empty, renovated_year: 2024, max_occupants: 3, exposure_view: "park view" });
const byLabel = Object.fromEntries(facts.map((f) => [f.label, f.value]));
ok("good to know parking + fee", byLabel.Parking === "1 outdoor parking space, $50 a month");
ok("good to know new facts", byLabel.Renovated === "2024" && byLabel.Appliances === "Fridge and stove" && byLabel.Nearby === "Close to Walkerville" && byLabel.Occupancy === "Up to 3 people" && byLabel.View === "park view");
const chips = buildAmenityChips({ flooring: "hardwood", exposure: ["south"], amenities: ["hardwood_floors"] });
ok("chips: flooring once + facing", chips.filter((c) => c === "Hardwood floors").length === 1 && chips.includes("South facing"));
const line = listingFactsLine({ ...empty, renovated_year: 2024, max_occupants: 3 })!;
ok("copy fact line", line.includes("Renovated in 2024.") && line.includes("Appliances: Fridge and stove.") && line.includes("Parking: $50 a month.") && line.includes("Nearby: Close to Walkerville.") && line.includes("Up to 3 people."));
ok("no em dash", !(line + JSON.stringify(facts)).includes("—"));

// Sister fill copies the building facts, never exposure.
const patch = sisterFillPatch({}, { renovated_year: 2023, nearby: "Walkerville", appliances: ["fridge"], flooring: "vinyl", parking_fee_cents: 5000, max_occupants: 2, exposure: ["south"], exposure_view: "river" } as never);
ok("sister copies new fields", (patch as Record<string, unknown>).flooring === "vinyl" && (patch as Record<string, unknown>).parking_fee_cents === 5000);
ok("sister skips exposure and reno year", !("exposure" in patch) && !("exposure_view" in patch) && !("renovated_year" in patch));

console.log(`test-listing-details: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
