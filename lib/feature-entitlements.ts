import { PLAN_FEATURES, hasEntitlement, type PlanFeature } from "./billing";
import { envFlagEnabled } from "./auto-listing-copy";

const SPECIAL_ORG_FEATURE_KEYS = [
  "ai_reply",
  "landlord_campaign",
] as const;

type SpecialOrgFeatureKey = (typeof SPECIAL_ORG_FEATURE_KEYS)[number];

export const ORG_FEATURE_KEYS = [
  ...SPECIAL_ORG_FEATURE_KEYS,
  ...PLAN_FEATURES,
] as const;

export type OrgFeatureKey = SpecialOrgFeatureKey | PlanFeature;

export type OrganizationFeatureFlag = {
  organization_id?: string | null;
  feature_key: string | null;
  enabled: boolean | null;
};

export type FeatureEntitlementOrg = {
  id?: string | null;
  plan?: string | null;
  featureFlags?: readonly OrganizationFeatureFlag[] | null;
  feature_flags?: readonly OrganizationFeatureFlag[] | null;
};

export type FeatureEnv = Record<string, string | null | undefined>;

export type FeatureResolverOptions = {
  env?: FeatureEnv;
};

export type OrgFeatureSetting = {
  key: OrgFeatureKey;
  label: string;
  description: string;
};

const SPECIAL_ORG_FEATURE_SETTINGS: Record<SpecialOrgFeatureKey, OrgFeatureSetting> = {
  ai_reply: {
    key: "ai_reply",
    label: "AI reply drafts",
    description: "Adds the AI draft helper to renter inquiry replies.",
  },
  landlord_campaign: {
    key: "landlord_campaign",
    label: "Landlord onboarding campaign",
    description: "Sends the rent-confirm and feature reveal sequence to eligible Free orgs.",
  },
};

const MAINTENANCE_ORG_FEATURE_SETTINGS = {
  incident_intake: {
    key: "incident_intake",
    label: "Tenant issue intake",
    description: "Lets tenants submit maintenance reports through their private link.",
  },
  incident_dispatch: {
    key: "incident_dispatch",
    label: "Trade dispatch",
    description: "Lets operators dispatch work orders to trades and manage quote scheduling.",
  },
} satisfies Record<"incident_intake" | "incident_dispatch", OrgFeatureSetting>;

export const SETTINGS_ORG_FEATURES: OrgFeatureSetting[] = [
  SPECIAL_ORG_FEATURE_SETTINGS.ai_reply,
  SPECIAL_ORG_FEATURE_SETTINGS.landlord_campaign,
  MAINTENANCE_ORG_FEATURE_SETTINGS.incident_intake,
  MAINTENANCE_ORG_FEATURE_SETTINGS.incident_dispatch,
];

const ORG_FEATURE_KEY_SET = new Set<string>(ORG_FEATURE_KEYS);
const PLAN_FEATURE_KEY_SET = new Set<string>(PLAN_FEATURES);

export function isOrgFeatureKey(value: string): value is OrgFeatureKey {
  return ORG_FEATURE_KEY_SET.has(value);
}

function isPlanFeatureKey(value: string): value is PlanFeature {
  return PLAN_FEATURE_KEY_SET.has(value);
}

export type FeatureEnvMaster =
  | "AI_REPLY_ENABLED"
  | "LANDLORD_CAMPAIGN_ENABLED";

export function envMasterForFeature(
  featureKey: OrgFeatureKey,
): FeatureEnvMaster | null {
  switch (featureKey) {
    case "ai_reply":
      return "AI_REPLY_ENABLED";
    case "landlord_campaign":
      return "LANDLORD_CAMPAIGN_ENABLED";
    default:
      return null;
  }
}

export function planDefaultForFeature(
  featureKey: string,
  plan: string | null | undefined,
): boolean {
  switch (featureKey) {
    case "ai_reply":
      return true;
    case "landlord_campaign":
      return plan === "free";
    default:
      return isPlanFeatureKey(featureKey) ? hasEntitlement(plan, featureKey) : false;
  }
}

function flagsForOrg(
  org: FeatureEntitlementOrg,
): readonly OrganizationFeatureFlag[] {
  return org.featureFlags ?? org.feature_flags ?? [];
}

export function featureFlagOverrideForOrg(
  featureKey: string,
  org: FeatureEntitlementOrg,
): boolean | null {
  const row = flagsForOrg(org).find((flag) => flag.feature_key === featureKey);
  if (!row) return null;
  return row.enabled === true;
}

export function isFeatureEnabledForOrg(
  featureKey: string,
  org: FeatureEntitlementOrg,
  options: FeatureResolverOptions = {},
): boolean {
  if (!isOrgFeatureKey(featureKey)) return false;

  const envMaster = envMasterForFeature(featureKey);
  if (envMaster && !envFlagEnabled(options.env?.[envMaster])) {
    return false;
  }

  const override = featureFlagOverrideForOrg(featureKey, org);
  if (override !== null) return override;

  return planDefaultForFeature(featureKey, org.plan);
}

type FeatureFlagClient = {
  from: (table: string) => any;
};

function normalizeFeatureRows(data: unknown): OrganizationFeatureFlag[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const featureKey = record.feature_key;
    if (typeof featureKey !== "string" || !isOrgFeatureKey(featureKey)) return [];
    return [
      {
        organization_id:
          typeof record.organization_id === "string" ? record.organization_id : null,
        feature_key: featureKey,
        enabled: record.enabled === true,
      },
    ];
  });
}

export async function loadOrganizationFeatureFlags(
  client: FeatureFlagClient,
  organizationId: string,
  featureKeys: readonly OrgFeatureKey[] = ORG_FEATURE_KEYS,
): Promise<OrganizationFeatureFlag[]> {
  const byOrg = await loadOrganizationFeatureFlagsByOrg(client, [organizationId], featureKeys);
  return byOrg.get(organizationId) ?? [];
}

export async function loadOrganizationFeatureFlagsByOrg(
  client: FeatureFlagClient,
  organizationIds: readonly string[],
  featureKeys: readonly OrgFeatureKey[] = ORG_FEATURE_KEYS,
): Promise<Map<string, OrganizationFeatureFlag[]>> {
  const orgIds = Array.from(new Set(organizationIds.filter(Boolean)));
  const keys = Array.from(new Set(featureKeys));
  const empty = new Map<string, OrganizationFeatureFlag[]>();
  if (orgIds.length === 0 || keys.length === 0) return empty;

  const { data, error } = await client
    .from("organization_feature_flags")
    .select("organization_id, feature_key, enabled")
    .in("organization_id", orgIds)
    .in("feature_key", keys);

  if (error) return empty;

  const grouped = new Map<string, OrganizationFeatureFlag[]>();
  for (const row of normalizeFeatureRows(data)) {
    if (!row.organization_id) continue;
    const rows = grouped.get(row.organization_id) ?? [];
    rows.push(row);
    grouped.set(row.organization_id, rows);
  }
  return grouped;
}
