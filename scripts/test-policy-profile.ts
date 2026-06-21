// Unit tests for the standard-policy profile merge (0048 slice 1 + 0049 slice 2).
// Run: npx tsx scripts/test-policy-profile.ts
import {
  POLICY_FIELDS,
  FEATURE_POLICY_FIELDS,
  resolveEffectivePolicy,
  resolveEffectiveFeatures,
  resolveBuildingProfile,
  validateBuildingPolicySettings,
  validatePolicyProfileSettings,
  type PolicyProfile,
} from "../lib/policy-profile";

// Blank utilities/pets form input — the slice-2b (0050) fields default to
// "inherit" so existing slice-1/2 validator cases keep their meaning.
const BLANK_FEAT = {
  heat_included: "",
  hydro_included: "",
  water_included: "",
  pets_cats: "",
  pets_dogs: "",
  pets_dog_size: "",
};

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// A representative Pillette org profile.
const PILLETTE: PolicyProfile = {
  lease_term: "1_year",
  smoking: "non_smoking",
  ac_type: "sleeve",
  on_site_management: true,
};

ok("POLICY_FIELDS has 4", POLICY_FIELDS.length === 4);

// --- resolveEffectivePolicy: inheritance ------------------------------------
{
  const { policy, inherited } = resolveEffectivePolicy({}, PILLETTE);
  ok("empty unit inherits all four values", policy.ac_type === "sleeve" && policy.smoking === "non_smoking" && policy.lease_term === "1_year" && policy.on_site_management === true);
  ok("all four marked inherited", inherited.size === 4 && inherited.has("ac_type") && inherited.has("smoking") && inherited.has("lease_term") && inherited.has("on_site_management"));
}

// --- unit override wins -----------------------------------------------------
{
  const { policy, inherited } = resolveEffectivePolicy(
    { ac_type: "central", lease_term: "month_to_month" },
    PILLETTE,
  );
  ok("unit ac_type override wins", policy.ac_type === "central");
  ok("unit lease_term override wins", policy.lease_term === "month_to_month");
  ok("non-overridden still inherit (smoking)", policy.smoking === "non_smoking");
  ok("overridden fields NOT in inherited set", !inherited.has("ac_type") && !inherited.has("lease_term"));
  ok("non-overridden ARE inherited", inherited.has("smoking") && inherited.has("on_site_management"));
}

// --- false is a real value, not "inherit" -----------------------------------
{
  const { policy, inherited } = resolveEffectivePolicy(
    { on_site_management: false },
    PILLETTE,
  );
  ok("unit on_site_management=false overrides profile true", policy.on_site_management === false);
  ok("a deliberate false is NOT inherited", !inherited.has("on_site_management"));
}

// --- null profile: nothing inherited, unit values pass through --------------
{
  const { policy, inherited } = resolveEffectivePolicy({ ac_type: "window" }, null);
  ok("null profile: unit value kept", policy.ac_type === "window");
  ok("null profile: missing fields are null", policy.smoking === null && policy.lease_term === null && policy.on_site_management === null);
  ok("null profile: nothing inherited", inherited.size === 0);
}

// --- both unset: field absent, not 'inherited' ------------------------------
{
  const { policy, inherited } = resolveEffectivePolicy({}, { lease_term: "1_year" });
  ok("only the set profile field resolves", policy.lease_term === "1_year");
  ok("unset-on-both -> null (ac_type)", policy.ac_type === null);
  ok("unset-on-both not inherited", !inherited.has("ac_type") && inherited.has("lease_term"));
}

// --- resolveEffectiveFeatures: merges into UnitFeatures, keeps other fields -
{
  const { features, inherited } = resolveEffectiveFeatures(
    {
      address_ignored: undefined,
      beds: 1,
      air_conditioning: false, // legacy boolean untouched
      balcony: true,
      // no policy overrides on the unit -> inherit
    } as never,
    PILLETTE,
  );
  ok("effective features carry inherited ac_type", features.ac_type === "sleeve");
  ok("effective features carry inherited smoking", features.smoking === "non_smoking");
  ok("legacy air_conditioning boolean preserved untouched", features.air_conditioning === false);
  ok("non-policy field (balcony) passes through", features.balcony === true);
  ok("inherited set reported for features merge", inherited.size === 4);
}

// --- resolveEffectiveFeatures: unit override beats profile ------------------
{
  const { features, inherited } = resolveEffectiveFeatures(
    { ac_type: "none" }, // deliberate "no A/C" on this unit
    PILLETTE,
  );
  ok("unit ac_type=none overrides profile sleeve", features.ac_type === "none");
  ok("ac_type not inherited when overridden", !inherited.has("ac_type"));
}

// --- null/undefined unit safe -----------------------------------------------
{
  const { features } = resolveEffectiveFeatures(null, PILLETTE);
  ok("null unit + profile -> inherits", features.ac_type === "sleeve" && features.lease_term === "1_year");
}

// ===========================================================================
// Slice 2 (0049): per-building override resolves building > org, then the
// existing unit > profile merge runs on top -> unit > building > org overall.
// ===========================================================================

// An org-wide baseline that does NOT match every building (the Mercer/Manning
// case): org A/C unset, lease 1-year, on-site false.
const ORG_DEFAULT: PolicyProfile = {
  lease_term: "1_year",
  smoking: null,
  ac_type: null,
  on_site_management: false,
};

// --- resolveBuildingProfile: building value wins, else org ------------------
{
  const building: PolicyProfile = {
    lease_term: null, // inherit org
    smoking: "non_smoking", // building override
    ac_type: "sleeve", // building override
    on_site_management: null, // inherit org
  };
  const merged = resolveBuildingProfile(building, ORG_DEFAULT);
  ok("building ac_type wins over unset org", merged.ac_type === "sleeve");
  ok("building smoking wins", merged.smoking === "non_smoking");
  ok("building lease_term null -> inherits org 1_year", merged.lease_term === "1_year");
  ok("building on_site null -> inherits org false", merged.on_site_management === false);
}

// --- resolveBuildingProfile: building false is a real value, not inherit ----
{
  const building: PolicyProfile = { on_site_management: false };
  const org: PolicyProfile = { on_site_management: true };
  const merged = resolveBuildingProfile(building, org);
  ok("building on_site=false overrides org true (false is a value)", merged.on_site_management === false);
}

// --- resolveBuildingProfile: null args safe ---------------------------------
{
  const onlyOrg = resolveBuildingProfile(null, ORG_DEFAULT);
  ok("null building -> pure org default", onlyOrg.lease_term === "1_year" && onlyOrg.ac_type === null);
  const onlyBuilding = resolveBuildingProfile({ ac_type: "central" }, null);
  ok("null org -> pure building", onlyBuilding.ac_type === "central" && onlyBuilding.lease_term === null);
  const neither = resolveBuildingProfile(null, null);
  ok("both null -> all-null profile", neither.ac_type === null && neither.lease_term === null);
}

// --- end-to-end precedence: unit > building > org ---------------------------
{
  const building: PolicyProfile = { ac_type: "sleeve", smoking: "non_smoking" };
  const merged = resolveBuildingProfile(building, ORG_DEFAULT);
  // Unit overrides A/C, inherits smoking from building, inherits lease from org.
  const { features, inherited } = resolveEffectiveFeatures(
    { ac_type: "central" } as never,
    merged,
  );
  ok("unit ac_type beats building", features.ac_type === "central");
  ok("building smoking inherited through to unit", features.smoking === "non_smoking");
  ok("org lease_term inherited through building to unit", features.lease_term === "1_year");
  ok("ac_type not marked inherited (unit set it)", !inherited.has("ac_type"));
  ok("smoking marked inherited (came from building/profile)", inherited.has("smoking"));
}

// --- validateBuildingPolicySettings: lease_term nullable (no 1_year floor) ---
{
  const r = validateBuildingPolicySettings({
    lease_term: "",
    smoking: "",
    ac_type: "",
    on_site_management: "",
    ...BLANK_FEAT,
  });
  ok("all-blank -> all null (no 1_year floor at building level)", r.values.policy_lease_term === null && r.values.policy_smoking === null && r.values.policy_ac_type === null && r.values.policy_on_site_management === null);
  ok("all-blank -> allInherit true (caller deletes the row)", r.allInherit === true);
}
{
  const r = validateBuildingPolicySettings({
    lease_term: "2_year",
    smoking: "non_smoking",
    ac_type: "sleeve",
    on_site_management: "false",
    ...BLANK_FEAT,
  });
  ok("valid values pass through", r.values.policy_lease_term === "2_year" && r.values.policy_smoking === "non_smoking" && r.values.policy_ac_type === "sleeve" && r.values.policy_on_site_management === false);
  ok("any field set -> allInherit false", r.allInherit === false);
}
{
  const r = validateBuildingPolicySettings({
    lease_term: "garbage",
    smoking: "nope",
    ac_type: "bogus",
    on_site_management: "maybe",
    ...BLANK_FEAT,
  });
  ok("invalid values normalize to null (inherit)", r.values.policy_lease_term === null && r.values.policy_smoking === null && r.values.policy_ac_type === null && r.values.policy_on_site_management === null);
  ok("all-invalid -> allInherit true", r.allInherit === true);
}

// ===========================================================================
// Slice 2b (0050): utilities (heat/hydro/water) + pets (cats/dogs/dog-size)
// extend the SAME unit > building > org inheritance. null = inherit.
// ===========================================================================

ok("FEATURE_POLICY_FIELDS has 6", FEATURE_POLICY_FIELDS.length === 6);

// A Pillette-style profile WITH utilities + pets: heat+water in, hydro out,
// cats + small dogs.
const PILLETTE_FULL: PolicyProfile = {
  ...PILLETTE,
  heat_included: true,
  hydro_included: false,
  water_included: true,
  pets_cats: true,
  pets_dogs: true,
  pets_dog_size: "small",
};

// --- resolveEffectiveFeatures: utilities/pets inherit + pet_friendly derived -
{
  const { features } = resolveEffectiveFeatures(
    { beds: 1, heat_included: null, pets_cats: null, pets_dogs: null } as never,
    PILLETTE_FULL,
  );
  ok("inherits heat_included=true", features.heat_included === true);
  ok("inherits hydro_included=false", features.hydro_included === false);
  ok("inherits water_included=true", features.water_included === true);
  ok("inherits pets_cats=true", features.pets_cats === true);
  ok("inherits pets_dogs=true", features.pets_dogs === true);
  ok("inherits pets_dog_size=small", features.pets_dog_size === "small");
  ok("pet_friendly re-derived from inherited cats/dogs", features.pet_friendly === true);
}

// --- a unit's explicit false beats an inherited true (no clobber) -----------
{
  const { features } = resolveEffectiveFeatures(
    { heat_included: false, pets_dogs: false } as never,
    PILLETTE_FULL,
  );
  ok("unit heat_included=false overrides profile true", features.heat_included === false);
  ok("unit pets_dogs=false overrides profile true", features.pets_dogs === false);
  ok("water still inherits true (not overridden)", features.water_included === true);
  ok("cats still inherits true; pet_friendly stays true", features.pets_cats === true && features.pet_friendly === true);
}

// --- no profile + no pets -> pet_friendly false ------------------------------
{
  const { features } = resolveEffectiveFeatures(
    { pets_cats: false, pets_dogs: false } as never,
    null,
  );
  ok("no cats/dogs -> pet_friendly false", features.pet_friendly === false);
  ok("utilities unset + null profile stay null (inherit)", features.heat_included === null);
}

// --- resolveBuildingProfile resolves utilities/pets building-over-org --------
{
  const org: PolicyProfile = {
    heat_included: false,
    water_included: false,
    pets_cats: false,
    pets_dogs: false,
    pets_dog_size: null,
  };
  const building: PolicyProfile = {
    heat_included: true, // building override
    // water_included null -> inherit org false
    pets_cats: true, // building override
    pets_dog_size: "medium",
  };
  const merged = resolveBuildingProfile(building, org);
  ok("building heat true beats org false", merged.heat_included === true);
  ok("building water null inherits org false", merged.water_included === false);
  ok("building cats true beats org false", merged.pets_cats === true);
  ok("building dogs null inherits org false", merged.pets_dogs === false);
  ok("building dog_size medium beats org null", merged.pets_dog_size === "medium");
}

// --- end-to-end unit > building > org for a utility -------------------------
{
  const org: PolicyProfile = { heat_included: false };
  const building: PolicyProfile = { heat_included: true };
  const merged = resolveBuildingProfile(building, org);
  const inheritUnit = resolveEffectiveFeatures({} as never, merged);
  ok("unit unset inherits building heat=true through org", inheritUnit.features.heat_included === true);
  const overrideUnit = resolveEffectiveFeatures({ heat_included: false } as never, merged);
  ok("unit heat=false beats building true", overrideUnit.features.heat_included === false);
}

// --- validators parse the utilities/pets fields ------------------------------
{
  const r = validatePolicyProfileSettings({
    lease_term: "",
    smoking: "",
    ac_type: "",
    on_site_management: "",
    heat_included: "true",
    hydro_included: "false",
    water_included: "",
    pets_cats: "true",
    pets_dogs: "",
    pets_dog_size: "small",
  });
  ok("org validator: lease_term floors to 1_year", r.values.policy_lease_term === "1_year");
  ok("org validator: heat true parsed", r.values.policy_heat_included === true);
  ok("org validator: hydro false parsed", r.values.policy_hydro_included === false);
  ok("org validator: water blank -> null", r.values.policy_water_included === null);
  ok("org validator: cats true parsed", r.values.policy_pets_cats === true);
  ok("org validator: dog_size small parsed", r.values.policy_pets_dog_size === "small");
  ok("org validator: bad dog_size ignored", validatePolicyProfileSettings({ lease_term: "", smoking: "", ac_type: "", on_site_management: "", ...BLANK_FEAT, pets_dog_size: "huge" }).values.policy_pets_dog_size === null);
}

// --- allInherit accounts for the feature fields ------------------------------
{
  // Only a utility overridden, all four core fields blank: NOT allInherit.
  const r = validateBuildingPolicySettings({
    lease_term: "",
    smoking: "",
    ac_type: "",
    on_site_management: "",
    ...BLANK_FEAT,
    heat_included: "true",
  });
  ok("a building overriding only a utility is NOT allInherit", r.allInherit === false);
  ok("its heat override parsed true", r.values.policy_heat_included === true);
}

console.log(`\npolicy-profile: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
