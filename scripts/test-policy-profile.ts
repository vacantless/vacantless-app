// Unit tests for the standard-policy profile merge (0048, S273 slice 1).
// Run: npx tsx scripts/test-policy-profile.ts
import {
  POLICY_FIELDS,
  resolveEffectivePolicy,
  resolveEffectiveFeatures,
  type PolicyProfile,
} from "../lib/policy-profile";

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

console.log(`\npolicy-profile: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
