// S841g: the emailed Rentals.ca sign-in code goes into the open window by
// itself; the next site's window starts early; a signed-out site with nothing
// waiting is not a health problem. Run: npx tsx scripts/test-s841g-code-early-window.ts
import { readFileSync } from "node:fs";
import { siteMailCopyLead, siteSigninCode } from "../lib/site-mail-pass";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}

// The real Rentals.ca email, read 2026-11-25 (code changed).
const text = [
  "Login Verification",
  "",
  "You are receiving this email because there was a recent login attempt on your Rentals.ca account. For your security, and to prevent abusive login attempts, we require two-factor authentication.",
  "",
  "To confirm you are an authorized user, please enter the one-time passcode below when prompted on the page.",
  "",
  "482913",
  "Please note that this code will expire in fifteen minutes.",
  "",
  "Copyright © 2026 Rentals.ca, Inc.",
].join("\n");
const subject = "Your Rentals.ca Listing - Verification Required";
const got = siteSigninCode({ domain: "rentals.ca", subject, text, html: null });
ok("reads the six-digit code", got?.code === "482913" && got?.channel === "rentals_ca", got);
const html = `<p>Login Verification</p><p>please enter the one-time passcode below when prompted</p><span style="letter-spacing:10px">482913</span><p>Copyright 2026</p>`;
ok("reads it from the html when there is no text", siteSigninCode({ domain: "rentals.ca", subject, text: null, html })?.code === "482913");
ok("never the copyright year", siteSigninCode({ domain: "rentals.ca", subject, text: text.replace("482913", ""), html: null }) === null);
ok("not from another site yet", siteSigninCode({ domain: "zumper.com", subject, text, html: null }) === null);
ok("not from a password reset", siteSigninCode({ domain: "rentals.ca", subject: "Reset your password - Verification Required", text, html: null }) === null);
ok("not from an ordinary email", siteSigninCode({ domain: "rentals.ca", subject: "Your listing is live", text, html: null }) === null);
ok("not without the passcode words", siteSigninCode({ domain: "rentals.ca", subject, text: "Verification\n482913", html: null }) === null);
ok("copy says it was typed", siteMailCopyLead("Rentals.ca", false, true).includes("We already typed the code into your open sign-in window."));
ok("copy unchanged otherwise", siteMailCopyLead("Rentals.ca") === "Rentals.ca sent this to your Vacantless address. It is not from a renter, so we passed it on to you.");

const server = readFileSync("lib/site-mail-pass-server.ts", "utf8");
ok("only into a window showing the code box", server.includes('.eq("detail", "enter_code")') && server.includes('.eq("status", "ready")'));
ok("only this account and this site", server.includes('.eq("organization_id", opts.orgId)') && server.includes('.eq("channel", found.channel)'));
ok("only a recent window", server.includes('.gte("created_at", since)'));
ok("the code is never logged", !/console\.log\([^)]*found\.code/.test(server));
ok("the owners still get the copy", server.includes("codeTyped") && server.includes("sendSiteMailCopy("));

const actions = readFileSync("app/dashboard/site-signin/[channel]/actions.ts", "utf8");
ok("prestart exists and never redirects", /export async function prestartSiteSignin[\s\S]*?\n}\n/.test(actions) && !/export async function prestartSiteSignin[\s\S]*?redirect\([\s\S]*?\n}\n/.test(actions.split("/** S735: the window panel opens the next site")[0]));
ok("prestart reuses an open window", actions.includes("return open.id as string;"));
const panel = readFileSync("app/dashboard/site-signin/[channel]/window-panel.tsx", "utf8");
ok("panel starts the next window early", panel.includes("prestartSiteSignin(nextChannel)") && panel.includes("prestarting.current = true"));
ok("Stop here closes the early window", panel.includes("if (prestarted.current) void cancelSiteSignin(prestarted.current);"));

const health = readFileSync("app/api/cron/health-digest/route.ts", "utf8");
ok("health: a site with nothing waiting is not a problem", health.includes("loadSiteWork(admin, s.organization_id)") && health.includes("input.signIns = keptSignIns;"));

console.log(`s841g code and early window: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
