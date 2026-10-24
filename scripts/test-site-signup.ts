// S736 (review item 7 second half): "Make my <site> account".
// Run: npx tsx scripts/test-site-signup.ts
import { readFileSync } from "node:fs";
import { SITE_SIGNUP_NOTE, cleanSignupPrefill, siteSigninView, SITE_SIGNIN_ACCOUNT_FIRST } from "../lib/site-signin";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const p = cleanSignupPrefill({ first_name: " Ava ", last_name: "Martin", email: "Ava@Example.com ", phone: "519-555-0100" });
ok("trims names", p.first_name === "Ava" && p.last_name === "Martin");
ok("email lowercased", p.email === "ava@example.com");
ok("phone kept", p.phone === "519-555-0100");
ok("bad email dropped", cleanSignupPrefill({ email: "nope" }).email === null);
ok("short phone dropped", cleanSignupPrefill({ phone: "555" }).phone === null);
ok("blank is null", cleanSignupPrefill({ first_name: "  " }).first_name === null);
ok("non-strings ignored", cleanSignupPrefill({ first_name: 5 as unknown as string }).first_name === null);

ok("filled view says details are in and password stays", /filled in your details/.test(siteSigninView("kijiji", "ready", "signup_filled").body) && /stays with you/.test(siteSigninView("kijiji", "ready", "signup_filled").body));
ok("open view", /sign-up page/.test(siteSigninView("zumper", "ready", "signup_open").body));
ok("no link view tells them to press Sign up", /Press Sign up/.test(siteSigninView("rentals_ca", "ready", "signup_link_missing").body));
ok("plain sign-in view unchanged", /Open the window and sign in/.test(siteSigninView("kijiji", "ready").body));
ok("zumper note names the ID check", /ID/.test(SITE_SIGNUP_NOTE.zumper));
ok("rentals note names the code", /code/.test(SITE_SIGNUP_NOTE.rentals_ca));
ok("account hints point at the new box", Object.values(SITE_SIGNIN_ACCOUNT_FIRST).every((h) => /Make it with us below/.test(h.text)));
ok("no em dash in new copy", !/—/.test(Object.values(SITE_SIGNUP_NOTE).join(" ")));

const action = readFileSync("app/dashboard/site-signin/[channel]/actions.ts", "utf8");
ok("action reads the sign-up mode", action.includes('formData.get("mode") === "signup"'));
ok("action stores mode and prefill", action.includes('mode: signup ? "signup" : "signin"') && action.includes("prefill: signup ? prefill : null"));
ok("action still needs the Posting add-on", action.includes("readRobotPostingAccess"));
ok("action never takes a password field", !/formData\.get\("password/.test(action));
const page = readFileSync("app/dashboard/site-signin/[channel]/page.tsx", "utf8");
ok("page offers Make my account", page.includes("Make my {name} account") && page.includes('name="mode" value="signup"'));
ok("page has no password box", !/type="password"/.test(page));
ok("page fills email from the login", page.includes("defaultValue={user?.email"));
const migration = readFileSync("supabase/migrations/0261_signin_window_signup_mode.sql", "utf8");
ok("migration adds mode and prefill", migration.includes("add column if not exists mode") && migration.includes("prefill jsonb"));

console.log(`\nsite-signup: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
