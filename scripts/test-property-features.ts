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

// --- hasAnyFeature ---------------------------------------------------------
ok("hasAnyFeature: bare -> false", !hasAnyFeature({}));
ok("hasAnyFeature: amenity -> true", hasAnyFeature({ balcony: true }));
ok("hasAnyFeature: utility -> true", hasAnyFeature({ heat_included: true }));
ok("hasAnyFeature: sqft -> true", hasAnyFeature({ sqft: 800 }));
ok("hasAnyFeature: floor -> true", hasAnyFeature({ floor: "3rd" }));
ok("hasAnyFeature: blank floor -> false", !hasAnyFeature({ floor: "  " }));
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

console.log(`\nproperty-features: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
