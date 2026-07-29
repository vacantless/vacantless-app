import { hasEntitlement } from "./billing";
import { envFlagEnabled } from "./auto-listing-copy";

export const ORG_FEATURE_KEYS = [
  "ai_reply",
  "landlord_campaign",
  "incident_intake",
  "incident_dispatch",
] as const;

export type OrgFeatureKey = (typeof ORG_FEATURE_KEYS)[number];

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

export const SETTINGS_ORG_FEATURES: OrgFeatureSetting[] = [
  {
    key: "ai_reply",
    label: "AI reply drafts",
    description: "Adds the AI draft helper to renter inquiry replies.",
  },
  {
    key: "landlord_campaign",
    label: "Landlord onboarding campaign",
    description: "Sends the rent-confirm and feature reveal sequence to eligible Free orgs.",
  },
  {
    key: "incident_intake",
    label: "Tenant issue intake",
    description: "Lets tenants submit maintenance reports through their private link.",
  },
  {
    key: "incident_dispatch",
    label: "Trade dispatch",
    description: "Lets operators dispatch work orders to trades and manage quote scheduling.",
  },
];

const ORG_FEATURE_KEY_SET = new Set<string>(ORG_FEATURE_KEYS);

export function isOrgFeatureKey(value: string): value is OrgFeatureKey {
  return ORG_FEATURE_KEY_SET.has(value);
}

export function envMasterForFeature(
  featureKey: OrgFeatureKey,
): "AI_REPLY_ENABLED" | "LANDLORD_CAMPAIGN_ENABLED" | null {
  switch (featureKey) {
    case "ai_reply":
      return "AI_REPLY_ENABLED";
    case "landlord_campaign":
      return "LANDLORD_CAMPAIGN_ENABLED";
    case "incident_intake":
    case "incident_dispatch":
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
    case "incident_intake":
      return hasEntitlement(plan, "incident_intake");
    case "incident_dispatch":
      return hasEntitlement(plan, "incident_dispatch");
    default:
      return false;
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
