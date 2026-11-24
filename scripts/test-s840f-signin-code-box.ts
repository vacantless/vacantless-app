// S840f: a pasted one-time code for the sign-in window, honest start time,
// and "you can close the tab" on done.
// Run: npx tsx scripts/test-s840f-signin-code-box.ts
import { readFileSync } from "node:fs";
import { cleanSigninCode, siteSigninView } from "../lib/site-signin";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

ok("digits pass", cleanSigninCode("482913") === "482913");
ok("spaces and dashes dropped", cleanSigninCode(" 482-913 ") === "482913" && cleanSigninCode("AB12 CD34") === "AB12CD34");
ok("too short or too long refused", cleanSigninCode("123") === null && cleanSigninCode("1234567890123") === null);
ok("a password is refused", cleanSigninCode("Hunter2!") === null && cleanSigninCode("my pass$word") === null);
ok("an email is refused", cleanSigninCode("pat@example.com") === null);
ok("empty refused", cleanSigninCode("") === null && cleanSigninCode(undefined) === null);

ok("start time is honest", siteSigninView("zumper", "starting").body.includes("a minute or two"));
ok("done says the tab can go", siteSigninView("zumper", "done").body.includes("You can close the sign-in window tab."));
ok("code step points at the box", siteSigninView("rentals_ca", "ready", "enter_code").body.includes("Paste it in the box below"));

const actions = readFileSync("app/dashboard/site-signin/[channel]/actions.ts", "utf8");
const send = actions.slice(actions.indexOf("export async function sendSiteSigninCode"));
ok("action cleans before saving", send.indexOf("cleanSigninCode(raw)") > 0 && send.indexOf("cleanSigninCode(raw)") < send.indexOf(".update("));
ok("action only writes the caller's own open window", send.includes('.eq("organization_id", who.orgId)') && send.includes('.eq("status", "ready")'));
ok("action checks the capability", send.includes("await allowed()"));

const panel = readFileSync("app/dashboard/site-signin/[channel]/window-panel.tsx", "utf8");
ok("box only while the window is ready", panel.indexOf('win.status === "ready" && link') < panel.indexOf("sendSiteSigninCode(win.id, code)"));
ok("a refused paste points to the window for passwords", panel.includes("Type your password in the window itself."));

const sql = readFileSync("supabase/migrations/0333_signin_window_type_code.sql", "utf8");
ok("migration is additive", /add column if not exists type_code text/.test(sql) && !/\bdrop\s+(table|column|function|policy)/i.test(sql));

console.log(`s840f signin code box: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
