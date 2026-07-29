// Unit tests for the per-org feature entitlement resolver.
// Run: npx tsx scripts/test-feature-entitlements.ts
import {
  featureFlagOverrideForOrg,
  isFeatureEnabledForOrg,
  planDefaultForFeature,
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

function org(
  plan: string | null,
  featureFlags: OrganizationFeatureFlag[] = [],
) {
  return { id: "org-1", plan, featureFlags };
}

const envOn = { AI_REPLY_ENABLED: "true", LANDLORD_CAMPAIGN_ENABLED: "true" };
const envOff = { AI_REPLY_ENABLED: "false", LANDLORD_CAMPAIGN_ENABLED: "false" };

ok(
  "env off: env-mastered feature resolves off even with org override on",
  isFeatureEnabledForOrg(
    "ai_reply",
    org("growth", [{ feature_key: "ai_reply", enabled: true }]),
    { env: envOff },
  ) === false,
);
ok(
  "no env master: incident intake skips env clause",
  isFeatureEnabledForOrg("incident_intake", org("growth"), { env: envOff }) === true,
);
ok(
  "plan default: incident intake is on for Growth",
  isFeatureEnabledForOrg("incident_intake", org("growth"), { env: envOn }) === true,
);
ok(
  "plan default: incident intake is off for Free",
  isFeatureEnabledForOrg("incident_intake", org("free"), { env: envOn }) === false,
);
ok(
  "plan default: incident dispatch is off for Growth",
  isFeatureEnabledForOrg("incident_dispatch", org("growth"), { env: envOn }) === false,
);
ok(
  "plan default: incident dispatch is on for Premium",
  isFeatureEnabledForOrg("incident_dispatch", org("premium"), { env: envOn }) === true,
);
ok(
  "per-org override: false disables a plan-default-on feature",
  isFeatureEnabledForOrg(
    "incident_intake",
    org("growth", [{ feature_key: "incident_intake", enabled: false }]),
    { env: envOn },
  ) === false,
);
ok(
  "per-org override: true enables a plan-default-off feature",
  isFeatureEnabledForOrg(
    "incident_dispatch",
    org("growth", [{ feature_key: "incident_dispatch", enabled: true }]),
    { env: envOn },
  ) === true,
);
ok(
  "unknown feature: fail closed",
  isFeatureEnabledForOrg("not_a_feature", org("premium"), { env: envOn }) === false,
);
ok(
  "maintenance no row: intake reproduces plan behavior",
  isFeatureEnabledForOrg("incident_intake", org("free"), { env: envOn }) ===
    planDefaultForFeature("incident_intake", "free"),
);
ok(
  "maintenance no row: dispatch reproduces plan behavior",
  isFeatureEnabledForOrg("incident_dispatch", org("premium"), { env: envOn }) ===
    planDefaultForFeature("incident_dispatch", "premium"),
);
ok(
  "AI reply: env on and no row defaults on like the previous global flag",
  isFeatureEnabledForOrg("ai_reply", org("free"), { env: envOn }) === true,
);
ok(
  "AI reply: org override can disable when env master is on",
  isFeatureEnabledForOrg(
    "ai_reply",
    org("free", [{ feature_key: "ai_reply", enabled: false }]),
    { env: envOn },
  ) === false,
);
ok(
  "landlord campaign: Free defaults on when env master is on",
  isFeatureEnabledForOrg("landlord_campaign", org("free"), { env: envOn }) === true,
);
ok(
  "landlord campaign: Growth defaults off when env master is on",
  isFeatureEnabledForOrg("landlord_campaign", org("growth"), { env: envOn }) === false,
);
ok(
  "override reader: absent row returns null",
  featureFlagOverrideForOrg("incident_intake", org("growth")) === null,
);
ok(
  "override reader: false row returns false",
  featureFlagOverrideForOrg(
    "incident_intake",
    org("growth", [{ feature_key: "incident_intake", enabled: false }]),
  ) === false,
);

if (failed > 0) {
  console.error(`\nfeature-entitlements: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nfeature-entitlements: ${passed} passed, 0 failed`);
