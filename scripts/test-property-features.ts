// Unit tests for the pure unit-feature logic. Run: npx tsx scripts/test-property-features.ts
import {
  LAUNDRY_OPTIONS,
  isLaundry,
  normalizeLaundry,
  laundryLabel,
  formatAvailability,
  isAvailableNow,
  formatSqft,
  buildSpecLine,
  buildAmenityChips,
  buildUtilitiesIncluded,
  utilitiesSummary,
  hasAnyFeature,
  DOG_SIZE_OPTIONS,
  isDogSize,
  normalizeDogSize,
  dogSizeLabel,
  derivePetFriendly,
  petPolicyLabel,
  AC_TYPE_OPTIONS,
  isAcType,
  normalizeAcType,
  acTypeLabel,
  acAmenityLabel,
  SMOKING_OPTIONS,
  isSmoking,
  normalizeSmoking,
  smokingLabel,
  LEASE_TERM_OPTIONS,
  isLeaseTerm,
  normalizeLeaseTerm,
  leaseTermLabel,
  UNIT_TYPE_OPTIONS,
  isUnitType,
  normalizeUnitType,
  mapUnitTypeFromRaw,
  unitTypeLabel,
  FOR_RENT_BY_OPTIONS,
  isForRentBy,
  normalizeForRentBy,
  forRentByLabel,
  smartLockLabel,
  AMENITY_KEYS,
  isAmenityKey,
  normalizeAmenities,
  AMENITY_LABELS,
  PARKING_TYPE_OPTIONS,
  isParkingType,
  formatParking,
  HEATING_TYPE_OPTIONS,
  isHeatingType,
  HEATING_TYPE_LABELS,
  feedPropertyType,
} from "../lib/property-features";

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

const NOW = new Date("2026-06-15T12:00:00Z");

// --- laundry ---------------------------------------------------------------
ok("LAUNDRY_OPTIONS has 4", LAUNDRY_OPTIONS.length === 4);
ok("isLaundry: in_suite", isLaundry("in_suite"));
ok("isLaundry: rejects junk", !isLaundry("dishwasher"));
ok("isLaundry: rejects non-string", !isLaundry(3));
ok("normalizeLaundry: trims + accepts", normalizeLaundry(" shared ") === "shared");
ok("normalizeLaundry: blank -> null", normalizeLaundry("") === null);
ok("normalizeLaundry: junk -> null", normalizeLaundry("nope") === null);
ok("normalizeLaundry: non-string -> null", normalizeLaundry(null) === null);
ok("laundryLabel: in_suite", laundryLabel("in_suite") === "In-suite laundry");
ok("laundryLabel: in_building", laundryLabel("in_building") === "Laundry in building");
ok("laundryLabel: shared", laundryLabel("shared") === "Shared laundry");
ok("laundryLabel: none", laundryLabel("none") === "No laundry");
ok("laundryLabel: junk -> null", laundryLabel("x") === null);

// --- availability ----------------------------------------------------------
ok("avail: null -> now", formatAvailability(null, NOW) === "Available now");
ok("avail: undefined -> now", formatAvailability(undefined, NOW) === "Available now");
ok("avail: blank -> now", formatAvailability("", NOW) === "Available now");
ok("avail: past date -> now", formatAvailability("2026-01-01", NOW) === "Available now");
ok("avail: today -> now", formatAvailability("2026-06-15", NOW) === "Available now");
ok(
  "avail: future same year -> no year",
  formatAvailability("2026-07-01", NOW) === "Available Jul 1",
);
ok(
  "avail: future next year -> shows year",
  formatAvailability("2027-01-15", NOW) === "Available Jan 15, 2027",
);
ok("avail: malformed -> now", formatAvailability("not-a-date", NOW) === "Available now");
ok("avail: bad month -> now", formatAvailability("2026-13-01", NOW) === "Available now");
ok("isAvailableNow: null", isAvailableNow(null, NOW));
ok("isAvailableNow: future false", !isAvailableNow("2026-07-01", NOW));

// --- sqft ------------------------------------------------------------------
ok("sqft: 850 -> 850 sq ft", formatSqft(850) === "850 sq ft");
ok("sqft: 1200 -> 1,200 sq ft", formatSqft(1200) === "1,200 sq ft");
ok("sqft: null -> null", formatSqft(null) === null);
ok("sqft: 0 -> null", formatSqft(0) === null);
ok("sqft: negative -> null", formatSqft(-5) === null);

// --- spec line -------------------------------------------------------------
ok(
  "spec: beds/baths/sqft/floor/parking",
  JSON.stringify(
    buildSpecLine({
      beds: 2,
      baths: 1,
      sqft: 850,
      floor: "2nd",
      parking: "1 spot",
    }),
  ) === JSON.stringify(["2 beds", "1 bath", "850 sq ft", "2nd floor", "Parking: 1 spot"]),
);
ok(
  "spec: 1 bed singular",
  buildSpecLine({ beds: 1 }).join("|") === "1 bed",
);
ok("spec: empty when nothing", buildSpecLine({}).length === 0);
ok(
  "spec: skips blank floor/parking",
  buildSpecLine({ beds: 2, floor: "  ", parking: "" }).join("|") === "2 beds",
);

// --- amenity chips ---------------------------------------------------------
ok(
  "chips: full set in order",
  JSON.stringify(
    buildAmenityChips({
      air_conditioning: true,
      balcony: true,
      laundry: "in_suite",
      furnished: true,
      pets_cats: true,
      pets_dogs: true,
    }),
  ) ===
    JSON.stringify([
      "Air conditioning",
      "Balcony",
      "In-suite laundry",
      "Furnished",
      "Cats & dogs welcome",
    ]),
);
ok("chips: empty when none", buildAmenityChips({}).length === 0);
ok(
  "chips: laundry 'none' is not a chip",
  buildAmenityChips({ laundry: "none" }).length === 0,
);
ok(
  "chips: only A/C",
  buildAmenityChips({ air_conditioning: true }).join("|") === "Air conditioning",
);
ok(
  "chips: false booleans excluded",
  buildAmenityChips({ air_conditioning: false, balcony: false }).length === 0,
);

// --- pets (structured policy, 0045) ----------------------------------------
ok("DOG_SIZE_OPTIONS has 4", DOG_SIZE_OPTIONS.length === 4);
ok("isDogSize: small", isDogSize("small"));
ok("isDogSize: rejects junk", !isDogSize("tiny"));
ok("isDogSize: rejects non-string", !isDogSize(2));
ok("normalizeDogSize: trims + accepts", normalizeDogSize(" large ") === "large");
ok("normalizeDogSize: blank -> null", normalizeDogSize("") === null);
ok("normalizeDogSize: junk -> null", normalizeDogSize("huge") === null);
ok("dogSizeLabel: any -> any size", dogSizeLabel("any") === "any size");
ok("dogSizeLabel: junk -> null", dogSizeLabel("nope") === null);

ok("derive: cats only -> true", derivePetFriendly({ pets_cats: true }) === true);
ok("derive: dogs only -> true", derivePetFriendly({ pets_dogs: true }) === true);
ok("derive: neither -> false", derivePetFriendly({}) === false);
ok(
  "derive: ignores legacy pet_friendly without structured",
  derivePetFriendly({ pet_friendly: true }) === false,
);

ok("petPolicy: none -> null", petPolicyLabel({}) === null);
ok(
  "petPolicy: cats only",
  petPolicyLabel({ pets_cats: true }) === "Cats welcome",
);
ok(
  "petPolicy: dogs only",
  petPolicyLabel({ pets_dogs: true }) === "Dogs welcome",
);
ok(
  "petPolicy: cats & dogs",
  petPolicyLabel({ pets_cats: true, pets_dogs: true }) === "Cats & dogs welcome",
);
ok(
  "petPolicy: dogs with size limit",
  petPolicyLabel({ pets_dogs: true, pets_dog_size: "small" }) ===
    "Dogs welcome (small dogs)",
);
ok(
  "petPolicy: cats & dogs with size limit",
  petPolicyLabel({ pets_cats: true, pets_dogs: true, pets_dog_size: "medium" }) ===
    "Cats & dogs welcome (medium dogs)",
);
ok(
  "petPolicy: size 'any' shows no parenthetical",
  petPolicyLabel({ pets_dogs: true, pets_dog_size: "any" }) === "Dogs welcome",
);
ok(
  "petPolicy: size on cats-only is ignored",
  petPolicyLabel({ pets_cats: true, pets_dog_size: "small" }) === "Cats welcome",
);
ok(
  "petPolicy: legacy fallback when no structured data",
  petPolicyLabel({ pet_friendly: true }) === "Pets welcome",
);

// --- utilities -------------------------------------------------------------
ok(
  "utils: all three",
  JSON.stringify(
    buildUtilitiesIncluded({
      heat_included: true,
      hydro_included: true,
      water_included: true,
    }),
  ) === JSON.stringify(["Heat", "Hydro", "Water"]),
);
ok("utils: none -> empty", buildUtilitiesIncluded({}).length === 0);
ok(
  "utils summary: single",
  utilitiesSummary({ heat_included: true }) === "Heat included",
);
ok(
  "utils summary: two -> ampersand",
  utilitiesSummary({ heat_included: true, water_included: true }) ===
    "Heat & water included",
);
ok(
  "utils summary: three -> oxford ampersand",
  utilitiesSummary({
    heat_included: true,
    hydro_included: true,
    water_included: true,
  }) === "Heat, hydro & water included",
);
ok("utils summary: none -> null", utilitiesSummary({}) === null);
ok(
  "utils: internet + cable append after water",
  JSON.stringify(
    buildUtilitiesIncluded({
      heat_included: true,
      water_included: true,
      internet_included: true,
      cable_included: true,
    }),
  ) === JSON.stringify(["Heat", "Water", "Internet", "Cable"]),
);
ok(
  "utils summary: internet + cable",
  utilitiesSummary({ internet_included: true, cable_included: true }) ===
    "Internet & cable included",
);

// --- channel-aware amenities / parking / heating ---------------------------
ok("AMENITY_KEYS includes dishwasher", AMENITY_KEYS.includes("dishwasher"));
ok("isAmenityKey: gym", isAmenityKey("gym"));
ok("isAmenityKey: rejects junk", !isAmenityKey("bowling_alley"));
ok(
  "normalizeAmenities: string aliases, de-dupes, stable order",
  JSON.stringify(normalizeAmenities("Gym, dishwasher, EV charging, gym, nope")) ===
    JSON.stringify(["dishwasher", "gym", "ev_charging"]),
);
ok(
  "normalizeAmenities: array trims + drops unknown",
  JSON.stringify(normalizeAmenities([" outdoor space ", "pool", "random"])) ===
    JSON.stringify(["pool", "outdoor_space"]),
);
ok("amenity label exported", AMENITY_LABELS.dishwasher === "Dishwasher");
ok(
  "chips: canonical amenities append before pets",
  JSON.stringify(
    buildAmenityChips({
      amenities: ["dishwasher", "gym"],
      pets_cats: true,
    }),
  ) === JSON.stringify(["Dishwasher", "Gym", "Cats welcome"]),
);

ok("PARKING_TYPE_OPTIONS has 7", PARKING_TYPE_OPTIONS.length === 7);
ok("isParkingType: underground", isParkingType("underground"));
ok("isParkingType: rejects driveway", !isParkingType("driveway"));
ok(
  "formatParking: structured type + count wins",
  formatParking("underground", 1, "free text") === "1 underground parking space",
);
ok(
  "formatParking: plural count",
  formatParking("garage", 2, null) === "2 garage parking spaces",
);
ok(
  "formatParking: none wins over free text",
  formatParking("none", 1, "1 spot") === "No parking",
);
ok(
  "formatParking: fallback free text",
  formatParking(null, null, "  tandem driveway  ") === "tandem driveway",
);
ok("formatParking: empty -> null", formatParking(null, null, " ") === null);

ok("HEATING_TYPE_OPTIONS has 7", HEATING_TYPE_OPTIONS.length === 7);
ok("isHeatingType: forced_air", isHeatingType("forced_air"));
ok("isHeatingType: rejects gas", !isHeatingType("gas"));
ok("heating label", HEATING_TYPE_LABELS.heat_pump === "Heat pump");

// --- hasAnyFeature ---------------------------------------------------------
ok("hasAnyFeature: bare -> false", !hasAnyFeature({}));
ok("hasAnyFeature: amenity -> true", hasAnyFeature({ balcony: true }));
ok("hasAnyFeature: utility -> true", hasAnyFeature({ heat_included: true }));
ok("hasAnyFeature: internet utility -> true", hasAnyFeature({ internet_included: true }));
ok("hasAnyFeature: canonical amenity -> true", hasAnyFeature({ amenities: ["gym"] }));
ok("hasAnyFeature: sqft -> true", hasAnyFeature({ sqft: 800 }));
ok("hasAnyFeature: floor -> true", hasAnyFeature({ floor: "3rd" }));
ok("hasAnyFeature: blank floor -> false", !hasAnyFeature({ floor: "  " }));
ok("smart lock label true", smartLockLabel(true) === "Smart lock");
ok("smart lock label false hidden", smartLockLabel(false) === null);
ok("hasAnyFeature: smart lock is operator-only", !hasAnyFeature({ has_smart_lock: true }));
ok(
  "hasAnyFeature: available_date alone -> false (shown separately)",
  !hasAnyFeature({ available_date: "2026-07-01" }),
);

// --- standard-policy field vocab (0048) ------------------------------------
ok("AC_TYPE_OPTIONS has 5", AC_TYPE_OPTIONS.length === 5);
ok("isAcType: sleeve", isAcType("sleeve"));
ok("isAcType: rejects junk", !isAcType("swamp"));
ok("normalizeAcType: trims", normalizeAcType(" central ") === "central");
ok("normalizeAcType: junk -> null", normalizeAcType("nope") === null);
ok("acTypeLabel: sleeve -> wall/sleeve", acTypeLabel("sleeve") === "wall/sleeve");
ok("acTypeLabel: central -> central air", acTypeLabel("central") === "central air");
ok("acTypeLabel: none -> null", acTypeLabel("none") === null);

ok("SMOKING_OPTIONS has 2", SMOKING_OPTIONS.length === 2);
ok("isSmoking: non_smoking", isSmoking("non_smoking"));
ok("isSmoking: rejects junk", !isSmoking("vaping"));
ok("normalizeSmoking: trims", normalizeSmoking(" smoking_permitted ") === "smoking_permitted");
ok("smokingLabel: non_smoking", smokingLabel("non_smoking") === "Non-smoking");
ok("smokingLabel: junk -> null", smokingLabel("x") === null);

ok("LEASE_TERM_OPTIONS has 4", LEASE_TERM_OPTIONS.length === 4);
ok("isLeaseTerm: 1_year", isLeaseTerm("1_year"));
ok("isLeaseTerm: rejects junk", !isLeaseTerm("3_year"));
ok("normalizeLeaseTerm: trims", normalizeLeaseTerm(" month_to_month ") === "month_to_month");
ok("leaseTermLabel: 1_year", leaseTermLabel("1_year") === "1-year lease");
ok("leaseTermLabel: month_to_month", leaseTermLabel("month_to_month") === "Month-to-month");

// --- acAmenityLabel (the ac_type-beats-boolean rule, Unit 20 fix) ----------
ok("ac: ac_type wins -> sleeve label", acAmenityLabel({ ac_type: "sleeve" }) === "Air conditioning (wall/sleeve)");
ok("ac: ac_type central", acAmenityLabel({ ac_type: "central" }) === "Air conditioning (central air)");
ok("ac: ac_type none -> null even if boolean true", acAmenityLabel({ ac_type: "none", air_conditioning: true }) === null);
ok("ac: no ac_type, boolean true -> plain label", acAmenityLabel({ air_conditioning: true }) === "Air conditioning");
ok("ac: no ac_type, boolean false -> null", acAmenityLabel({ air_conditioning: false }) === null);
ok("ac: nothing -> null", acAmenityLabel({}) === null);

// --- amenity chips with policy fields --------------------------------------
ok(
  "chips: A/C type + non-smoking + on-site in order",
  JSON.stringify(
    buildAmenityChips({
      ac_type: "sleeve",
      balcony: true,
      furnished: true,
      smoking: "non_smoking",
      on_site_management: true,
      pets_cats: true,
    }),
  ) ===
    JSON.stringify([
      "Air conditioning (wall/sleeve)",
      "Balcony",
      "Furnished",
      "Non-smoking",
      "On-site management",
      "Cats welcome",
    ]),
);
ok(
  "chips: smoking_permitted is NOT a chip",
  buildAmenityChips({ smoking: "smoking_permitted" }).length === 0,
);
ok(
  "chips: ac_type none suppresses A/C even with boolean",
  buildAmenityChips({ ac_type: "none", air_conditioning: true }).length === 0,
);

// ---------------------------------------------------------------------------
// S450 (Codex #9): a condo level typed as "Level 15" must not render
// "Level 15 floor" (double word); the value already names a level.
ok(
  "spec line: 'Level 15' not doubled with floor",
  buildSpecLine({ floor: "Level 15" }).includes("Level 15") &&
    !buildSpecLine({ floor: "Level 15" }).some((x) => /floor/i.test(x)),
);
ok(
  "spec line: bare '2nd' still gets 'floor'",
  buildSpecLine({ floor: "2nd" }).includes("2nd floor"),
);
ok(
  "spec line: '2nd floor' not doubled",
  !buildSpecLine({ floor: "2nd floor" }).includes("2nd floor floor"),
);

// --- unit_type (Kijiji autopilot field map, S550) --------------------------
ok("UNIT_TYPE_OPTIONS has 6", UNIT_TYPE_OPTIONS.length === 6);
ok("isUnitType: condo", isUnitType("condo"));
ok("isUnitType: hyphenated basement", isUnitType("basement-apartment"));
ok("isUnitType: rejects junk", !isUnitType("loft"));
ok("isUnitType: rejects non-string", !isUnitType(2));
ok("normalizeUnitType: trims + accepts", normalizeUnitType(" condo ") === "condo");
ok("normalizeUnitType: blank -> null", normalizeUnitType("") === null);
ok("normalizeUnitType: junk -> null", normalizeUnitType("mansion") === null);
ok("normalizeUnitType: non-string -> null", normalizeUnitType(null) === null);
ok("mapUnitType: condo apartment -> condo", mapUnitTypeFromRaw("Condo Apartment") === "condo");
ok("mapUnitType: condo apt -> condo", mapUnitTypeFromRaw("Condo Apt") === "condo");
ok("mapUnitType: comm element condo -> condo", mapUnitTypeFromRaw("Comm Element Condo") === "condo");
ok("mapUnitType: bare apartment -> apartment", mapUnitTypeFromRaw("Apartment") === "apartment");
ok("mapUnitType: apartment with condo context -> condo", mapUnitTypeFromRaw("Apartment Condo") === "condo");
ok("mapUnitType: condo townhouse -> townhouse", mapUnitTypeFromRaw("Condo Townhouse") === "townhouse");
ok("mapUnitType: att/row/townhouse -> townhouse", mapUnitTypeFromRaw("Att/Row/Townhouse") === "townhouse");
ok("mapUnitType: freehold townhouse -> townhouse", mapUnitTypeFromRaw("Freehold Townhouse") === "townhouse");
ok("mapUnitType: row -> townhouse", mapUnitTypeFromRaw("Row") === "townhouse");
ok("mapUnitType: detached -> house", mapUnitTypeFromRaw("Detached") === "house");
ok("mapUnitType: semi-detached -> house", mapUnitTypeFromRaw("Semi-Detached") === "house");
ok("mapUnitType: duplex -> duplex-triplex", mapUnitTypeFromRaw("Duplex") === "duplex-triplex");
ok("mapUnitType: multiplex -> duplex-triplex", mapUnitTypeFromRaw("Multiplex") === "duplex-triplex");
ok("mapUnitType: basement -> basement-apartment", mapUnitTypeFromRaw("Basement Apartment") === "basement-apartment");
ok("mapUnitType: lower level -> basement-apartment", mapUnitTypeFromRaw("Lower Level") === "basement-apartment");
ok("mapUnitType: unknown -> null", mapUnitTypeFromRaw("Other") === null);
ok("unitTypeLabel: apartment", unitTypeLabel("apartment") === "Apartment");
ok(
  "unitTypeLabel: basement-apartment",
  unitTypeLabel("basement-apartment") === "Basement apartment",
);
ok(
  "unitTypeLabel: duplex-triplex",
  unitTypeLabel("duplex-triplex") === "Duplex / triplex",
);
ok("unitTypeLabel: junk -> null", unitTypeLabel("x") === null);
ok("feedPropertyType: apartment", feedPropertyType("apartment", null) === "apartment");
ok("feedPropertyType: condo", feedPropertyType("condo", null) === "condo");
ok("feedPropertyType: house", feedPropertyType("house", null) === "house");
ok("feedPropertyType: townhouse", feedPropertyType("townhouse", null) === "townhouse");
ok(
  "feedPropertyType: basement-apartment -> basement",
  feedPropertyType("basement-apartment", null) === "basement",
);
ok(
  "feedPropertyType: duplex-triplex -> duplex",
  feedPropertyType("duplex-triplex", null) === "duplex",
);
ok("feedPropertyType: room pass-through", feedPropertyType("room", null) === "room");
ok(
  "feedPropertyType: structure fallback condo",
  feedPropertyType(null, "condo") === "condo",
);
ok(
  "feedPropertyType: structure fallback freehold",
  feedPropertyType(null, "freehold") === "house",
);
ok("feedPropertyType: unknown -> apartment", feedPropertyType("mansion", null) === "apartment");

// --- for_rent_by (NOT NULL default 'owner') --------------------------------
ok("FOR_RENT_BY_OPTIONS has 2", FOR_RENT_BY_OPTIONS.length === 2);
ok("isForRentBy: owner", isForRentBy("owner"));
ok("isForRentBy: professional", isForRentBy("professional"));
ok("isForRentBy: rejects junk", !isForRentBy("agent"));
ok(
  "normalizeForRentBy: trims + accepts professional",
  normalizeForRentBy(" professional ") === "professional",
);
ok(
  "normalizeForRentBy: blank -> owner (never null)",
  normalizeForRentBy("") === "owner",
);
ok("normalizeForRentBy: junk -> owner", normalizeForRentBy("agent") === "owner");
ok(
  "normalizeForRentBy: non-string -> owner",
  normalizeForRentBy(null) === "owner",
);
ok("forRentByLabel: owner", forRentByLabel("owner") === "Owner");
ok(
  "forRentByLabel: professional",
  forRentByLabel("professional") === "Real estate professional",
);
ok("forRentByLabel: junk -> null", forRentByLabel("x") === null);

console.log(`\nproperty-features: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
