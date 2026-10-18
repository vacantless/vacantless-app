// S709: "Forget this sign-in" on the site sign-in tiles. Run: npx tsx scripts/test-forget-signin.ts
import { readFileSync } from "node:fs";
import { isSiteSigninChannel } from "../lib/site-signin";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const actions = readFileSync("app/dashboard/link-portals/actions.ts", "utf8");
const fn = actions.slice(actions.indexOf("export async function forgetSiteSignin"));
const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
ok("action exists", body.length > 50);
ok("action is capability gated", body.includes('requireCapability("manage_properties"'));
ok("action accepts only sign-in sites", body.includes("isSiteSigninChannel(channel)"));
ok("session delete is scoped to the caller's org and site",
  /from\("distribution_channel_sessions"\)\s*\.delete\(\)\s*\.eq\("organization_id", org\.id\)\s*\.eq\("channel", channel\)/.test(body));
ok("account marked as needing a new sign-in",
  body.includes('account_status: "needs_login"') && /from\("distribution_channel_accounts"\)[\s\S]*\.eq\("organization_id", org\.id\)\s*\.eq\("channel", channel\)/.test(body));
ok("action never trusts an org id from the client", !/organizationId|org_id\s*:/.test(body.split("{")[0]));
ok("kijiji and zumper are sign-in sites", isSiteSigninChannel("kijiji") && isSiteSigninChannel("zumper"));
// S717: Rentals.ca signs in from the home runner, so it is a sign-in site too.
ok("rentals.ca is a sign-in site", isSiteSigninChannel("rentals_ca"));
ok("other sites are refused", !isSiteSigninChannel("facebook_page") && !isSiteSigninChannel("x"));

const vm = readFileSync("app/dashboard/link-portals/view-model.ts", "utf8");
ok("tile offers it only with an account, on a sign-in site, with a saved sign-in",
  vm.includes('hasAccount && isSiteSigninChannel(row.channel) && row.lastCheckCode !== "no_session"'));

const tiles = readFileSync("app/dashboard/link-portals/connect-tiles.tsx", "utf8");
ok("tile asks before forgetting, in the page", tiles.includes("function ForgetSignin") && tiles.includes("setAsking(true)"));
ok("no browser dialog", !/window\.confirm|\bconfirm\(/.test(tiles));

for (const loc of ["en", "fr"]) {
  const m = JSON.parse(readFileSync(`messages/${loc}.json`, "utf8")).stage1.forget;
  ok(`${loc}: all five strings`, ["button", "confirm", "yes", "cancel", "error"].every((k) => typeof m?.[k] === "string" && m[k].length > 0));
  ok(`${loc}: confirm names the site`, String(m?.confirm).includes("{name}"));
  ok(`${loc}: no em dash`, !/[‒-―]/.test(JSON.stringify(m)));
}

console.log(`\nforget-signin: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
