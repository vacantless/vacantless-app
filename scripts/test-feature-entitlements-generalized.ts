// Unit tests for the generalized per-org feature entitlement resolver.
// Run: npx tsx scripts/test-feature-entitlements-generalized.ts
import { readFileSync } from "node:fs";
import {
  PLAN_ENTITLEMENTS,
  PLAN_FEATURES,
  hasEntitlement,
  type PlanFeature,
} from "../lib/billing";
import {
  ORG_FEATURE_KEYS,
  SETTINGS_ORG_FEATURES,
  envMasterForFeature,
  featureFlagOverrideForOrg,
  isFeatureEnabledForOrg,
  isOrgFeatureKey,
  planDefaultForFeature,
  type OrgFeatureKey,
  type OrganizationFeatureFlag,
} from "../lib/feature-entitlements";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  X ${name}`);
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  );
}

function org(
  plan: string | null,
  featureFlags: OrganizationFeatureFlag[] = [],
) {
  return { id: "org-1", plan, featureFlags };
}

const envOn = {
  AI_REPLY_ENABLED: "true",
  LANDLORD_CAMPAIGN_ENABLED: "true",
};

ok(
  "ORG_FEATURE_KEYS includes every billing feature plus the two platform toggles",
  sameSet(ORG_FEATURE_KEYS, ["ai_reply", "landlord_campaign", ...PLAN_FEATURES]),
);
ok(
  "every billing feature key is accepted by the org-feature guard",
  PLAN_FEATURES.every((feature) => isOrgFeatureKey(feature)),
);
ok(
  "settings metadata is the curated four override-controlled features",
  JSON.stringify(SETTINGS_ORG_FEATURES.map((feature) => feature.key)) ===
    JSON.stringify([
      "ai_reply",
      "landlord_campaign",
      "incident_intake",
      "incident_dispatch",
    ]),
);
ok(
  "settings metadata does not expose paid plan toggles",
  !SETTINGS_ORG_FEATURES.some((feature) =>
    ["accounting", "rent_collection", "tax_export", "market_rent"].includes(
      feature.key,
    ),
  ),
);

for (const plan of Object.keys(PLAN_ENTITLEMENTS)) {
  for (const featureKey of ORG_FEATURE_KEYS) {
    ok(
      `no override matches default: ${plan}.${featureKey}`,
      isFeatureEnabledForOrg(featureKey, org(plan), { env: envOn }) ===
        planDefaultForFeature(featureKey, plan),
    );
  }
}

for (const plan of Object.keys(PLAN_ENTITLEMENTS)) {
  for (const featureKey of PLAN_FEATURES) {
    ok(
      `plan default derives from billing: ${plan}.${featureKey}`,
      planDefaultForFeature(featureKey, plan) ===
        hasEntitlement(plan, featureKey as PlanFeature),
    );
  }
}

ok(
  "on override enables a plan-off billing feature",
  isFeatureEnabledForOrg(
    "accounting",
    org("growth", [{ feature_key: "accounting", enabled: true }]),
    { env: envOn },
  ) === true,
);
ok(
  "off override disables a plan-on billing feature",
  isFeatureEnabledForOrg(
    "rent_collection",
    org("free", [{ feature_key: "rent_collection", enabled: false }]),
    { env: envOn },
  ) === false,
);
ok(
  "env master off beats a platform-feature on override",
  isFeatureEnabledForOrg(
    "ai_reply",
    org("growth", [{ feature_key: "ai_reply", enabled: true }]),
    { env: { ...envOn, AI_REPLY_ENABLED: "false" } },
  ) === false,
);
ok(
  "only platform toggles have env masters",
  envMasterForFeature("ai_reply") === "AI_REPLY_ENABLED" &&
    envMasterForFeature("landlord_campaign") === "LANDLORD_CAMPAIGN_ENABLED" &&
    envMasterForFeature("lease_ocr") === null &&
    envMasterForFeature("listing_ai_import") === null &&
    envMasterForFeature("market_rent") === null,
);
ok(
  "unknown feature fails closed",
  isFeatureEnabledForOrg("not_a_feature", org("premium"), { env: envOn }) === false,
);
ok(
  "override reader accepts every generalized org key",
  ORG_FEATURE_KEYS.every((featureKey: OrgFeatureKey) => {
    const flag = { feature_key: featureKey, enabled: true };
    return featureFlagOverrideForOrg(featureKey, org("trial", [flag])) === true;
  }),
);

const adminActionSource = readFileSync("app/dashboard/admin/actions.ts", "utf8");
ok(
  "admin action is exported",
  adminActionSource.includes("export async function setOrgFeatureFlagAsAdmin"),
);
ok(
  "admin action rejects a non-admin caller before service-role writes",
  /if \(!isAdminEmail\(user\?\.email, adminEmails\(\)\)\) {[\s\S]*redirect\("\/dashboard\/admin\?features=forbidden"\);[\s\S]*}/.test(
    adminActionSource,
  ),
);
ok(
  "admin action uses service-role writes against organization_feature_flags",
  adminActionSource.includes("const admin = createAdminClient()") &&
    adminActionSource.includes('.from("organization_feature_flags")') &&
    adminActionSource.indexOf("const admin = createAdminClient()") <
      adminActionSource.indexOf('.from("organization_feature_flags")'),
);
ok(
  "admin action can clear an override row",
  adminActionSource.includes('mode === "default"') &&
    adminActionSource.includes(".delete()"),
);

if (failed > 0) {
  console.error(`\nfeature-entitlements-generalized: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nfeature-entitlements-generalized: ${passed} passed, 0 failed`);
