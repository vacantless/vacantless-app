// Pure checks for the Facebook Page OAuth/session helper.
// Run: npx tsx scripts/test-facebook-page-oauth.ts

import { Buffer } from "node:buffer";
import { encryptSessionState } from "../lib/distribution-session-crypto";
import {
  createOAuthState,
  facebookPageScopes,
  facebookReturnPath,
  instagramAccountLabel,
  normalizeInstagramBusinessAccount,
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
