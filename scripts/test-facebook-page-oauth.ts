// Pure checks for the Facebook Page OAuth/session helper.
// Run: npx tsx scripts/test-facebook-page-oauth.ts

import { Buffer } from "node:buffer";
import { encryptSessionState } from "../lib/distribution-session-crypto";
import {
  FACEBOOK_PAGE_BASE_SCOPES,
  createOAuthState,
  facebookPageScopes,
  facebookReturnPath,
  igChannelEnabledForOrg,
  instagramAccountLabel,
  normalizeInstagramBusinessAccount,
  parseIgChannelOrgAllowlist,
  signCookiePayload,
  verifyCookiePayload,
  verifyOAuthState,
} from "../lib/facebook-page-oauth";

process.env.FB_APP_SECRET = "test-secret";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function sameArray(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const signed = signCookiePayload({ orgId: "org1", exp: Date.now() + 60_000 });
ok("signed cookie verifies", verifyCookiePayload<{ orgId: string; exp?: unknown }>(signed)?.orgId === "org1");
ok(
  "tampered cookie fails",
  verifyCookiePayload(`${signed.slice(0, -1)}x`) === null,
);

const expired = signCookiePayload({ orgId: "org1", exp: Date.now() - 1 });
ok("expired cookie fails", verifyCookiePayload(expired) === null);

const state = createOAuthState({ orgId: "org1", propertyId: "prop1" });
ok(
  "oauth state requires matching cookie",
  verifyOAuthState({ stateParam: state.token, cookieValue: state.token })?.propertyId === "prop1",
);
ok(
  "oauth state mismatch fails",
  verifyOAuthState({ stateParam: state.token, cookieValue: signed }) === null,
);

const env = encryptSessionState(
  JSON.stringify({ page_id: "page1", page_access_token: "token" }),
  Buffer.alloc(32, 7),
);
ok("session envelope has 12-byte iv", env.iv.length === 12);
ok("session envelope has ciphertext", env.ciphertext.length > 0);
ok("session envelope has auth tag", env.authTag.length === 16);

ok(
  "property return path anchors to distribute",
  facebookReturnPath("prop1", "connected") ===
    "/dashboard/properties/prop1?fb=connected#distribute-header",
);
ok(
  "error return path carries reason",
  facebookReturnPath(null, "error", "state") === "/dashboard/properties?fb=error&reason=state",
);
ok(
  "facebook scopes stay FB-only by default",
  !facebookPageScopes({ instagramEnabled: false }).includes("instagram_basic"),
);
ok(
  "instagram scopes are opt-in",
  facebookPageScopes({ instagramEnabled: true }).includes("instagram_content_publish"),
);

const originalIgFlag = process.env.IG_CHANNEL_ENABLED;
const growthTestOrg = "8ea1da48-0cd2-45a4-bfba-023b31a67884";
const agileOrg = "921f7c08-98af-428f-a238-36f4a781b0de";
const allowlist = parseIgChannelOrgAllowlist(
  ` ${growthTestOrg.toUpperCase()} , , not-a-uuid,${growthTestOrg}`,
);
ok("IG allowlist keeps normalized UUIDs only", allowlist.size === 1);
ok("IG allowlist lowercases entries", allowlist.has(growthTestOrg));

delete process.env.IG_CHANNEL_ENABLED;
ok("IG org gate is off when global flag is unset", !igChannelEnabledForOrg(growthTestOrg, allowlist));

process.env.IG_CHANNEL_ENABLED = "true";
ok("IG org gate allows all orgs with empty allowlist", igChannelEnabledForOrg(agileOrg, new Set()));
ok("IG org gate preserves global semantics for unresolved org with empty allowlist", igChannelEnabledForOrg(null, new Set()));
ok("IG org gate allows allowlisted org", igChannelEnabledForOrg(growthTestOrg.toUpperCase(), allowlist));
ok("IG org gate blocks non-allowlisted org", !igChannelEnabledForOrg(agileOrg, allowlist));
ok("IG org gate fails closed for null org with non-empty allowlist", !igChannelEnabledForOrg(null, allowlist));
ok("IG org gate fails closed for blank org with non-empty allowlist", !igChannelEnabledForOrg("   ", allowlist));
ok(
  "facebook scopes stay exactly base for non-allowlisted org",
  sameArray(
    facebookPageScopes({ instagramEnabled: igChannelEnabledForOrg(agileOrg, allowlist) }),
    FACEBOOK_PAGE_BASE_SCOPES,
  ),
);
if (originalIgFlag == null) delete process.env.IG_CHANNEL_ENABLED;
else process.env.IG_CHANNEL_ENABLED = originalIgFlag;

ok(
  "normalizes linked Instagram account",
  normalizeInstagramBusinessAccount({ id: " ig1 ", username: "@vacantless" })?.username === "vacantless",
);
ok(
  "invalid Instagram account is null",
  normalizeInstagramBusinessAccount({ username: "vacantless" }) === null,
);
ok(
  "instagram account label prefers username",
  instagramAccountLabel({ id: "ig1", username: "vacantless" }) === "@vacantless",
);

console.log(`facebook-page-oauth: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
