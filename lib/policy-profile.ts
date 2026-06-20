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
  isAcType,
  isSmoking,
  isLeaseTerm,
  normalizeLeaseTerm,
  normalizeSmoking,
  normalizeAcType,
} from "./property-features";

/**
 * The org-level standard-policy defaults (organizations.policy_*). Each field
 * is null when no org default is set; lease_term defaults to "1_year" in the DB
 * but may still arrive here as a value or null defensively.
 */
export type PolicyProfile = {
  lease_term?: LeaseTerm | string | null;
  smoking?: Smoking | string | null;
  ac_type?: AcType | string | null;
  on_site_management?: boolean | null;
};

// The four policy fields the profile owns. Used for the provenance set + tests.
export const POLICY_FIELDS = [
  "lease_term",
  "smoking",
  "ac_type",
  "on_site_management",
] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];

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

/**
 * Resolve the four effective policy values from a unit's own overrides + the
 * org profile, and report which ones were INHERITED (unit unset, profile
 * supplied) so a UI can label provenance ("from building profile"). A field
 * that's unset on BOTH unit and profile is simply absent (not "inherited").
 */
export function resolveEffectivePolicy(
  unit: UnitPolicyInput | null | undefined,
  profile: PolicyProfile | null | undefined,
): { policy: Required<PolicyProfile>; inherited: Set<PolicyField> } {
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
  const { policy, inherited } = resolveEffectivePolicy(
    {
      lease_term: base.lease_term,
      smoking: base.smoking,
      ac_type: base.ac_type,
      on_site_management: base.on_site_management,
    },
    profile,
  );
  return {
    features: {
      ...base,
      lease_term: policy.lease_term,
      smoking: policy.smoking,
      ac_type: policy.ac_type,
      on_site_management: policy.on_site_management,
    },
    inherited,
  };
}

// --- Settings save validation ----------------------------------------------

/** The org-profile columns written by the Settings save (organizations.policy_*). */
export type PolicyProfileValues = {
  policy_lease_term: LeaseTerm;
  policy_smoking: Smoking | null;
  policy_ac_type: AcType | null;
  policy_on_site_management: boolean | null;
};

/**
 * Validate + normalize the Building-standard-policy settings form. lease_term is
 * NOT NULL in the DB, so a blank/invalid value falls back to the "1_year"
 * default; the other three normalize to a valid value or null (= no default).
 * on_site_management is tri-state: "true"/"false"/anything-else -> true/false/null.
 * Never throws — always returns a clean, constraint-safe row.
 */
export function validatePolicyProfileSettings(input: {
  lease_term: string;
  smoking: string;
  ac_type: string;
  on_site_management: string;
}): { ok: true; values: PolicyProfileValues } {
  const osm = input.on_site_management.trim();
  return {
    ok: true,
    values: {
      policy_lease_term: normalizeLeaseTerm(input.lease_term) ?? "1_year",
      policy_smoking: normalizeSmoking(input.smoking),
      policy_ac_type: normalizeAcType(input.ac_type),
      policy_on_site_management:
        osm === "true" ? true : osm === "false" ? false : null,
    },
  };
}

// Re-export the validators the settings/property save actions reuse, so callers
// import policy vocab from one place.
export { isAcType, isSmoking, isLeaseTerm };
