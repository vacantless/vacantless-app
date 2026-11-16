// Two-step sign-in gate (S803). Run: npx tsx scripts/test-two-step.ts
import { cleanCode, isGatedPath, twoStepDecision, twoStepPitch, CODE_PAGE } from "../lib/two-step";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const d = (pathname: string, currentLevel: "aal1" | "aal2" | null, nextLevel: "aal1" | "aal2" | null) =>
  twoStepDecision({ pathname, currentLevel, nextLevel });

// gated pages
ok("dashboard gated", isGatedPath("/dashboard"));
ok("dashboard child gated", isGatedPath("/dashboard/money"));
ok("onboarding gated", isGatedPath("/onboarding"));
ok("join gated", isGatedPath("/join/abc"));
ok("dashboards-lookalike not gated", !isGatedPath("/dashboardx"));
ok("code page not gated", !isGatedPath(CODE_PAGE));
ok("login not gated", !isGatedPath("/login"));
ok("auth callback not gated", !isGatedPath("/auth/callback"));
ok("signout not gated", !isGatedPath("/auth/signout"));
ok("renter page not gated", !isGatedPath("/r/123"));
ok("homepage not gated", !isGatedPath("/"));

// decisions
ok("no code set up -> allow", d("/dashboard", "aal1", "aal1") === "allow");
ok("code set up, not typed -> verify", d("/dashboard", "aal1", "aal2") === "verify");
ok("code set up, typed -> allow", d("/dashboard/money", "aal2", "aal2") === "allow");
ok("code set up, not typed, public page -> allow", d("/r/x", "aal1", "aal2") === "allow");
ok("code set up, not typed, code page -> allow", d(CODE_PAGE, "aal1", "aal2") === "allow");
ok("missing levels -> allow", d("/dashboard", null, null) === "allow");
ok("missing current with code -> verify", d("/dashboard", null, "aal2") === "verify");

// codes
ok("six digits", cleanCode("123456") === "123456");
ok("spaces dropped", cleanCode(" 123 456 ") === "123456");
ok("dash dropped", cleanCode("123-456") === "123456");
ok("five digits refused", cleanCode("12345") === null);
ok("letters refused", cleanCode("12345a") === null);
ok("empty refused", cleanCode("") === null);
ok("null refused", cleanCode(null) === null);

// wording
ok("rent pitch names rent", twoStepPitch(true).startsWith("You collect rent here."));
ok("plain pitch has no rent line", !twoStepPitch(false).includes("rent"));
ok("no em dashes", !/—/.test(twoStepPitch(true) + twoStepPitch(false)));

console.log(`two-step: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
