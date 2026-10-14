// S714: account pages answer on the app host only, so a homepage sign-up is
// still signed in when Stripe / Facebook / email bring the landlord back.
// Run: npx tsx scripts/test-canonical-host.ts
import { readFileSync } from "node:fs";
import { canonicalRedirect, isAccountPath } from "../lib/canonical-host";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}
const C = "app.vacantless.com";
const r = (host: string, pathname: string, search = "", method = "GET") =>
  canonicalRedirect({ host, method, pathname, search, canonicalHost: C });

// The S714 bug: sign up on www, Stripe returns to app.
ok("www signup moves to app, plan kept", r("www.vacantless.com", "/signup", "?plan=growth") === "https://app.vacantless.com/signup?plan=growth");
ok("bare domain login moves", r("vacantless.com", "/login") === "https://app.vacantless.com/login");
ok("www dashboard moves", r("www.vacantless.com", "/dashboard/billing", "?checkout=success") === "https://app.vacantless.com/dashboard/billing?checkout=success");
ok("www onboarding moves", r("www.vacantless.com", "/onboarding", "?plan=growth") !== null);
ok("email confirm link keeps its token", r("www.vacantless.com", "/auth/confirm", "?token_hash=abc&type=email") === "https://app.vacantless.com/auth/confirm?token_hash=abc&type=email");
ok("password reset moves", r("www.vacantless.com", "/reset-password") !== null && r("www.vacantless.com", "/forgot-password") !== null);

// Marketing and renter pages stay put.
ok("homepage stays on www", r("www.vacantless.com", "/") === null);
ok("about stays", r("www.vacantless.com", "/about") === null);
ok("privacy/terms stay", r("www.vacantless.com", "/privacy") === null && r("www.vacantless.com", "/terms") === null);
ok("public rental page stays", r("www.vacantless.com", "/r/abc") === null);
ok("a path that only starts with the word is not an account page", !isAccountPath("/signups-info") && !isAccountPath("/dashboarding"));

// Never moved.
ok("form posts never move", r("www.vacantless.com", "/signup", "", "POST") === null);
ok("api never moves", r("www.vacantless.com", "/api/cron/sweep-all") === null && r("vacantless-app.vercel.app", "/api/x") === null);
ok("the app host itself is served", r("app.vacantless.com", "/dashboard") === null);
ok("host case does not matter", r("WWW.Vacantless.com", "/login") === "https://app.vacantless.com/login");
ok("unknown hosts (previews) are served", r("vacantless-app-git-x.vercel.app", "/dashboard") === null);

// S700 behaviour kept: the old Vercel host moves every page.
ok("legacy host moves any page", r("vacantless-app.vercel.app", "/r/abc", "?p=1") === "https://app.vacantless.com/r/abc?p=1");

const mw = readFileSync("middleware.ts", "utf8");
ok("middleware uses the helper and a permanent redirect", mw.includes("canonicalRedirect(") && mw.includes("308"));

console.log(`\ncanonical-host: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
