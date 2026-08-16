// Source guards for S657 channel automation consent actions.
// Run: npx tsx scripts/test-channel-automation-authorization.ts
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

const source = readFileSync(
  "app/dashboard/properties/distribution-actions.ts",
  "utf8",
);
const oauthSource = readFileSync("lib/facebook-page-oauth.ts", "utf8");

const helper = section(
  source,
  "function apiAutomaticChannelFromForm",
  "async function requireCurrentOrgProperty",
);
const authorize = section(
  source,
  "export async function authorizeChannelAutomation",
  "export async function revokeChannelAutomation",
);
const revoke = section(
  source,
  "export async function revokeChannelAutomation",
  "// S570: the operator authorizes autopilot",
);

ok("api helper is present", helper.length > 0);
ok(
  "api helper rejects non-api-automatic channels",
  helper.includes('channel.mode !== "api_automatic"'),
);
ok(
  "api helper never accepts an org id from the form",
  !helper.includes("organization_id") && !helper.includes("org_id"),
);

ok("authorize action is present", authorize.length > 0);
ok(
  "authorize requires manage_properties",
  authorize.includes('await requireCapability("manage_properties", FORBIDDEN)'),
);
ok(
  "authorize resolves current org",
  authorize.includes("const org = await getCurrentOrg()"),
);
ok(
  "authorize requires a connected account before consent",
  authorize.includes('acct.account_status !== "connected"'),
);
ok(
  "authorize writes automation_authorized true",
  authorize.includes("automation_authorized: true"),
);
ok(
  "authorize stamps authorized_at",
  authorize.includes("automation_authorized_at: nowISO"),
);
ok(
  "authorize stamps authorized_by",
  authorize.includes("automation_authorized_by: uid"),
);
ok(
  "authorize update is scoped by current org",
  authorize.includes('.eq("organization_id", org.id)'),
);
ok(
  "authorize update is still connected-row scoped",
  authorize.includes('.eq("account_status", "connected")'),
);

ok("revoke action is present", revoke.length > 0);
ok(
  "revoke writes automation_authorized false",
  revoke.includes("automation_authorized: false"),
);
ok(
  "revoke nulls authorized_at",
  revoke.includes("automation_authorized_at: null"),
);
ok(
  "revoke nulls authorized_by",
  revoke.includes("automation_authorized_by: null"),
);
ok(
  "revoke update is scoped by current org",
  revoke.includes('.eq("organization_id", org.id)'),
);
ok(
  "consent events reuse publish attempt audit when a run item exists",
  source.includes("operator_authorized_channel_automation") &&
    source.includes("operator_revoked_channel_automation") &&
    source.includes('from("distribution_publish_attempts")'),
);
ok(
  "Facebook Page OAuth connect leaves automation unauthorized",
  oauthSource.includes("channel: FACEBOOK_FEED_CHANNEL") &&
    oauthSource.includes("automation_authorized: false") &&
    oauthSource.includes("automation_authorized_at: null") &&
    oauthSource.includes("automation_authorized_by: null"),
);

console.log(
  `\nchannel-automation-authorization: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);
