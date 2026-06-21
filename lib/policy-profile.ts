// ============================================================================
// Standard-policy PROFILE merge (migration 0048, S273 slice 1).
// Pure helpers — no DOM / env / IO (see scripts/test-policy-profile.ts).
//
// A building/org STANDARD-POLICY profile holds the building-constant fields
// (lease term, smoking, A/C type, on-site management) so they aren't re-keyed
// per unit and per portal. resolveEffectiveFeatures merges the profile DEFAULT
// under each unit's own value and is consumed by every listing surface (fill
// sheet, copy, description; the public page + feed merge the same rule in SQL
// inside get_public_listing / get_org_listing_feed) so nothing drifts.
//
// Precedence (per the spec): unit value  >  org profile default  >  unset.
// Because these four fields are NULLABLE on the unit from birth (0048), null
// means "inherit" UNAMBIGUOUSLY — there is no false-vs-unset trap here (that
// trap only afflicts the legacy NOT NULL feature booleans, which a later slice
// addresses with an override sentinel).
//
// Forward-compat with HYBRID granularity: resolveEffectiveFeatures takes an
// ALREADY-RESOLVED PolicyProfile. A future per-building layer just resolves the
// building override ahead of the org default and hands the result in here — no
// change to this merge.
// ============================================================================

import {
  type UnitFeatures,
  type AcType,
  type Smoking,
  type LeaseTerm,
  type DogSize,
  isAcType,
  isSmoking,
  isLeaseTerm,
  normalizeLeaseTerm,
  normalizeSmoking,
  normalizeAcType,
  normalizeDogSize,
  derivePetFriendly,
} from "./property-features";

/**
 * The org/building standard-policy defaults (organizations.policy_* /
 * org_building_policies.policy_*). Each field is null when no default is set.
 *
 * The first four (lease_term / smoking / ac_type / on_site_management) are the
 * 0048/0049 slice-1/2 fields. The utilities + pets fields (heat/hydro/water
 * included, pets_cats/dogs, pets_dog_size) are the 0050 slice-2b extension —
 * the existing per-unit feature booleans made inheritable (null = inherit).
 */
export type PolicyProfile = {
  lease_term?: LeaseTerm | string | null;
  smoking?: Smoking | string | null;
  ac_type?: AcType | string | null;
  on_site_management?: boolean | null;
  // Utilities + pets (0050). null = no default at this level.
  heat_included?: boolean | null;
  hydro_included?: boolean | null;
  water_included?: boolean | null;
  pets_cats?: boolean | null;
  pets_dogs?: boolean | null;
  pets_dog_size?: DogSize | string | null;
};

// The four ORIGINAL policy fields the profile owns (0048/0049). Used for the
// provenance set (fill-sheet "from building profile" labels) + tests. The 0050
// utilities/pets fields resolve identically but are NOT tracked in this set
// (the fill sheet only labels these four), so the provenance typing is unchanged.
export const POLICY_FIELDS = [
  "lease_term",
  "smoking",
  "ac_type",
  "on_site_management",
] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];

// The utilities + pets fields the 0050 slice adds to inheritance.
export const FEATURE_POLICY_FIELDS = [
  "heat_included",
  "hydro_included",
  "water_included",
  "pets_cats",
  "pets_dogs",
  "pets_dog_size",
] as const;
export type FeaturePolicyField = (typeof FEATURE_POLICY_FIELDS)[number];

/** A unit's OWN policy values (the per-unit override columns; null = inherit). */
export type UnitPolicyInput = {
  lease_term?: LeaseTerm | string | null;
  smoking?: Smoking | string | null;
  ac_type?: AcType | string | null;
  on_site_management?: boolean | null;
};

// Treat null AND undefined alike as "unset / inherit". Booleans are real values
// even when false (on_site_management = false is a deliberate "no", distinct
// from null = inherit — these columns are nullable, so that distinction holds).
function isSet<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

// The four resolved policy values (0048/0049). Spelled out rather than
// Required<PolicyProfile> so adding the 0050 utilities/pets fields to
// PolicyProfile doesn't force them into this four-field result.
type ResolvedFourPolicy = {
  lease_term: LeaseTerm | string | null;
  smoking: Smoking | string | null;
  ac_type: AcType | string | null;
  on_site_management: boolean | null;
};

/**
 * Resolve the four effective policy values from a unit's own overrides + the
 * org profile, and report which ones were INHERITED (unit unset, profile
 * supplied) so a UI can label provenance ("from building profile"). A field
 * that's unset on BOTH unit and profile is simply absent (not "inherited").
 */
export function resolveEffectivePolicy(
  unit: UnitPolicyInput | null | undefined,
  profile: PolicyProfile | null | undefined,
): { policy: ResolvedFourPolicy; inherited: Set<PolicyField> } {
  const u = unit ?? {};
  const p = profile ?? {};
  const inherited = new Set<PolicyField>();

  function pick<K extends PolicyField>(
    key: K,
  ): NonNullable<PolicyProfile[K]> | null {
    const uv = u[key as keyof UnitPolicyInput] as PolicyProfile[K];
    if (isSet(uv)) return uv as NonNullable<PolicyProfile[K]>;
    const pv = p[key];
    if (isSet(pv)) {
      inherited.add(key);
      return pv as NonNullable<PolicyProfile[K]>;
    }
    return null;
  }

  return {
    policy: {
      lease_term: pick("lease_term"),
      smoking: pick("smoking"),
      ac_type: pick("ac_type"),
      on_site_management: pick("on_site_management"),
    },
    inherited,
  };
}

/**
 * Merge the org policy profile UNDER a unit's raw features, returning the
 * EFFECTIVE UnitFeatures every listing surface should build from, plus the set
 * of policy fields that came from the profile (for provenance labels).
 *
 * The unit's own feature fields pass through untouched; only the four policy
 * fields are resolved. The legacy air_conditioning boolean is left as-is — it
 * stays the back-compat A/C fallback in acAmenityLabel when no ac_type resolves.
 */
export function resolveEffectiveFeatures(
  unit: UnitFeatures | null | undefined,
  profile: PolicyProfile | null | undefined,
): { features: UnitFeatures; inherited: Set<PolicyField> } {
  const base = unit ?? {};
  const p = profile ?? {};
  const { policy, inherited } = resolveEffectivePolicy(
    {
      lease_term: base.lease_term,
      smoking: base.smoking,
      ac_type: base.ac_type,
      on_site_management: base.on_site_management,
    },
    profile,
  );

  // Utilities + pets (0050): each unit field, when null/undefined, inherits the
  // already-resolved (building-over-org) profile value. Mirrors the SQL
  // coalesce(unit, building, org, false) in get_public_listing / the feed /
  // submit_public_lead. dog_size has no boolean floor (null stays null = no
  // limit advertised). pet_friendly is RE-DERIVED from the resolved cats/dogs.
  const heat = isSet(base.heat_included) ? base.heat_included : (p.heat_included ?? null);
  const hydro = isSet(base.hydro_included) ? base.hydro_included : (p.hydro_included ?? null);
  const water = isSet(base.water_included) ? base.water_included : (p.water_included ?? null);
  const cats = isSet(base.pets_cats) ? base.pets_cats : (p.pets_cats ?? null);
  const dogs = isSet(base.pets_dogs) ? base.pets_dogs : (p.pets_dogs ?? null);
  const dogSize = isSet(base.pets_dog_size)
    ? base.pets_dog_size
    : (p.pets_dog_size ?? null);

  return {
    features: {
      ...base,
      lease_term: policy.lease_term,
      smoking: policy.smoking,
      ac_type: policy.ac_type,
      on_site_management: policy.on_site_management,
      heat_included: heat,
      hydro_included: hydro,
      water_included: water,
      pets_cats: cats,
      pets_dogs: dogs,
      pets_dog_size: dogSize,
      pet_friendly: derivePetFriendly({ pets_cats: cats, pets_dogs: dogs }),
    },
    inherited,
  };
}

/**
 * Resolve the per-building override AHEAD of the org default into a single
 * PolicyProfile (migration 0049, slice 2 — the HYBRID layer). Per field:
 * building value wins; else the org default; else unset. The result is handed
 * straight to resolveEffectiveFeatures, so the unit > building > org precedence
 * is just resolveEffectiveFeatures(unit, resolveBuildingProfile(building, org)).
 *
 * This is exactly the forward-compat path the slice-1 header described: the
 * per-building layer resolves its override before the existing unit-vs-profile
 * merge runs, with no change to that merge. Both args may be null (no building
 * override row, or no org loaded).
 */
export function resolveBuildingProfile(
  building: PolicyProfile | null | undefined,
  org: PolicyProfile | null | undefined,
): PolicyProfile {
  const b = building ?? {};
  const o = org ?? {};
  function pick<K extends keyof PolicyProfile>(key: K): PolicyProfile[K] {
    const bv = b[key];
    if (isSet(bv)) return bv;
    return o[key] ?? null;
  }
  return {
    lease_term: pick("lease_term"),
    smoking: pick("smoking"),
    ac_type: pick("ac_type"),
    on_site_management: pick("on_site_management"),
    // Utilities + pets (0050) resolve building-over-org too.
    heat_included: pick("heat_included"),
    hydro_included: pick("hydro_included"),
    water_included: pick("water_included"),
    pets_cats: pick("pets_cats"),
    pets_dogs: pick("pets_dogs"),
    pets_dog_size: pick("pets_dog_size"),
  };
}

// --- Settings save validation ----------------------------------------------

// Tri-state checkbox/select value: "true"/"false"/anything-else -> true/false/null.
function triStateBool(raw: string): boolean | null {
  const v = raw.trim();
  return v === "true" ? true : v === "false" ? false : null;
}

// The six utilities/pets fields shared by the org + building saves (0050). All
// nullable: null = no default at this level (org) / inherit (building).
export type FeaturePolicyValues = {
  policy_heat_included: boolean | null;
  policy_hydro_included: boolean | null;
  policy_water_included: boolean | null;
  policy_pets_cats: boolean | null;
  policy_pets_dogs: boolean | null;
  policy_pets_dog_size: DogSize | null;
};

export type FeaturePolicyInput = {
  heat_included: string;
  hydro_included: string;
  water_included: string;
  pets_cats: string;
  pets_dogs: string;
  pets_dog_size: string;
};

/** Parse the six utilities/pets fields off a settings form (org or building). */
export function parseFeaturePolicy(input: FeaturePolicyInput): FeaturePolicyValues {
  return {
    policy_heat_included: triStateBool(input.heat_included),
    policy_hydro_included: triStateBool(input.hydro_included),
    policy_water_included: triStateBool(input.water_included),
    policy_pets_cats: triStateBool(input.pets_cats),
    policy_pets_dogs: triStateBool(input.pets_dogs),
    policy_pets_dog_size: normalizeDogSize(input.pets_dog_size),
  };
}

/** True when every utilities/pets field is "inherit" (all null). */
export function featurePolicyAllInherit(v: FeaturePolicyValues): boolean {
  return (
    v.policy_heat_included === null &&
    v.policy_hydro_included === null &&
    v.policy_water_included === null &&
    v.policy_pets_cats === null &&
    v.policy_pets_dogs === null &&
    v.policy_pets_dog_size === null
  );
}

/** The org-profile columns written by the Settings save (organizations.policy_*). */
export type PolicyProfileValues = {
  policy_lease_term: LeaseTerm;
  policy_smoking: Smoking | null;
  policy_ac_type: AcType | null;
  policy_on_site_management: boolean | null;
} & FeaturePolicyValues;

/**
 * Validate + normalize the Building-standard-policy settings form. lease_term is
 * NOT NULL in the DB, so a blank/invalid value falls back to the "1_year"
 * default; the other three normalize to a valid value or null (= no default).
 * on_site_management is tri-state: "true"/"false"/anything-else -> true/false/null.
 * Never throws — always returns a clean, constraint-safe row.
 */
export function validatePolicyProfileSettings(
  input: {
    lease_term: string;
    smoking: string;
    ac_type: string;
    on_site_management: string;
  } & FeaturePolicyInput,
): { ok: true; values: PolicyProfileValues } {
  const osm = input.on_site_management.trim();
  return {
    ok: true,
    values: {
      policy_lease_term: normalizeLeaseTerm(input.lease_term) ?? "1_year",
      policy_smoking: normalizeSmoking(input.smoking),
      policy_ac_type: normalizeAcType(input.ac_type),
      policy_on_site_management:
        osm === "true" ? true : osm === "false" ? false : null,
      ...parseFeaturePolicy(input),
    },
  };
}

/**
 * The per-building override columns written by the building-policy save
 * (org_building_policies.policy_*). ALL FOUR are nullable here — unlike the org
 * row, a building may inherit the org's lease_term (null = inherit), so there is
 * no "1_year" floor.
 */
export type BuildingPolicyValues = {
  policy_lease_term: LeaseTerm | null;
  policy_smoking: Smoking | null;
  policy_ac_type: AcType | null;
  policy_on_site_management: boolean | null;
} & FeaturePolicyValues;

/**
 * Validate + normalize a per-building override form (0049, slice 2). Every field
 * is tri-state — a blank/invalid value means "inherit the org default" (null),
 * NOT a hardcoded fallback. `allInherit` is true when nothing is overridden, so
 * the caller can DELETE the row instead of storing an all-null override (keeps
 * org_building_policies free of no-op rows). Never throws.
 */
export function validateBuildingPolicySettings(
  input: {
    lease_term: string;
    smoking: string;
    ac_type: string;
    on_site_management: string;
  } & FeaturePolicyInput,
): { ok: true; values: BuildingPolicyValues; allInherit: boolean } {
  const osm = input.on_site_management.trim();
  const features = parseFeaturePolicy(input);
  const values: BuildingPolicyValues = {
    policy_lease_term: normalizeLeaseTerm(input.lease_term),
    policy_smoking: normalizeSmoking(input.smoking),
    policy_ac_type: normalizeAcType(input.ac_type),
    policy_on_site_management:
      osm === "true" ? true : osm === "false" ? false : null,
    ...features,
  };
  const allInherit =
    values.policy_lease_term === null &&
    values.policy_smoking === null &&
    values.policy_ac_type === null &&
    values.policy_on_site_management === null &&
    featurePolicyAllInherit(features);
  return { ok: true, values, allInherit };
}

// Re-export the validators the settings/property save actions reuse, so callers
// import policy vocab from one place.
export { isAcType, isSmoking, isLeaseTerm };
