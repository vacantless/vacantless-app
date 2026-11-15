// Google sign-in and the 8-character password floor (S800, REVIEW-S799 item 7).
// Run: npx tsx scripts/test-google-sign-in.ts
import { readFileSync } from "node:fs";
import { googleRedirectTo, signupNext } from "../lib/google-sign-in";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const O = "https://app.vacantless.com";
const back = (next: string | null) => new URL(googleRedirectTo(O, next));

ok("returns to our own callback", back("/dashboard").origin === O && back("/dashboard").pathname === "/auth/callback");
ok("keeps an app page", back("/onboarding?plan=growth").searchParams.get("next") === "/onboarding?plan=growth");
ok("keeps a team invite", back("/join/abc").searchParams.get("next") === "/join/abc");
ok("another site falls back to the dashboard", back("https://evil.example/x").searchParams.get("next") === "/dashboard");
ok("//host falls back to the dashboard", back("//evil.example").searchParams.get("next") === "/dashboard");
ok("nothing -> dashboard", back(null).searchParams.get("next") === "/dashboard");

ok("sign-up goes to onboarding", signupNext("") === "/onboarding");
ok("sign-up carries plan and referral", signupNext("?plan=growth&ref=R1") === "/onboarding?ref=R1&plan=growth");
ok("sign-up from a team invite returns to it", signupNext("?next=/join/tok") === "/join/tok");
ok("a bad next on sign-up is ignored", signupNext("?next=https://evil.example&plan=growth") === "/onboarding?plan=growth");

// wiring
const signup = readFileSync("app/signup/page.tsx", "utf8");
const login = readFileSync("app/login/page.tsx", "utf8");
const reset = readFileSync("app/reset-password/page.tsx", "utf8");
ok("sign-up page offers Google", /<GoogleSignIn/.test(signup));
ok("log-in page offers Google", /<GoogleSignIn/.test(login));
ok("sign-up asks for 8 characters", /minLength=\{8\}/.test(signup) && !/minLength=\{6\}/.test(signup));
ok("new password asks for 8 characters", !/minLength=\{6\}/.test(reset) && /minLength=\{8\}/.test(reset));
ok("no page still says 6 characters", !/At least 6 characters/.test(signup + reset));

console.log(`\ntest-google-sign-in: ${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
