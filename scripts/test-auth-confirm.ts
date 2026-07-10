// Unit tests for the pure /auth/confirm helpers (lib/auth-confirm.ts).
// Run: npx tsx scripts/test-auth-confirm.ts
import {
  planEmailConfirm,
  isAllowedOtpType,
  safeNextPath,
  CONFIRM_OTP_TYPES,
} from "../lib/auth-confirm";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- isAllowedOtpType ------------------------------------------------------
ok("recovery is allowed", isAllowedOtpType("recovery"));
ok("signup is allowed", isAllowedOtpType("signup"));
ok("invite is allowed", isAllowedOtpType("invite"));
ok("null type rejected", !isAllowedOtpType(null));
ok("garbage type rejected", !isAllowedOtpType("pkce"));
ok("empty type rejected", !isAllowedOtpType(""));

// --- safeNextPath ----------------------------------------------------------
ok("relative path kept", safeNextPath("/reset-password") === "/reset-password");
ok("protocol-relative rejected", safeNextPath("//evil.com") === "/dashboard");
ok("absolute url rejected", safeNextPath("https://evil.com") === "/dashboard");
ok("null -> fallback", safeNextPath(null) === "/dashboard");
ok(
  "custom fallback honored",
  safeNextPath(null, "/onboarding") === "/onboarding",
);
ok("non-slash rejected", safeNextPath("reset-password") === "/dashboard");

// --- planEmailConfirm ------------------------------------------------------
ok("valid recovery plan", (() => {
  const r = planEmailConfirm({
    token_hash: "abc",
    type: "recovery",
    next: "/reset-password",
  });
  return (
    r.ok &&
    r.type === "recovery" &&
    r.token_hash === "abc" &&
    r.next === "/reset-password"
  );
})());
ok(
  "missing token_hash -> not ok",
  !planEmailConfirm({ token_hash: null, type: "recovery", next: "/x" }).ok,
);
ok(
  "empty token_hash -> not ok",
  !planEmailConfirm({ token_hash: "", type: "recovery", next: "/x" }).ok,
);
ok(
  "bad type -> not ok",
  !planEmailConfirm({ token_hash: "abc", type: "nope", next: "/x" }).ok,
);
ok("open-redirect next sanitized in plan", (() => {
  const r = planEmailConfirm({
    token_hash: "abc",
    type: "signup",
    next: "//evil.com",
  });
  return r.ok && r.next === "/dashboard";
})());
ok("missing next -> dashboard", (() => {
  const r = planEmailConfirm({
    token_hash: "abc",
    type: "recovery",
    next: null,
  });
  return r.ok && r.next === "/dashboard";
})());
ok("all six otp types present", CONFIRM_OTP_TYPES.length === 6);

console.log(`\nauth-confirm: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
