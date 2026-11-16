// S806: REVIEW-S805 wording pass (findings 5, 8, 9, 12 to 16).
// Run: npx tsx scripts/test-s806-wording.ts
import { readFileSync } from "node:fs";
import { FACEBOOK_RENEW_CHIP, FACEBOOK_RENEW_HOW } from "../lib/facebook-renew";
import { buildPostingAdvice } from "../lib/posting-advice";

let passed = 0;
let failed = 0;
const ok = (n: string, c: boolean) => (c ? passed++ : (failed++, console.error(`FAIL: ${n}`)));
const read = (p: string) => readFileSync(p, "utf8");

const list = read("app/dashboard/properties/page.tsx");
ok("5: Marketplace is one chip on a row", FACEBOOK_RENEW_CHIP === "Marketplace: check renew" && list.includes("{FACEBOOK_RENEW_CHIP}"));
ok("5: short how line", FACEBOOK_RENEW_HOW === "Open your Marketplace ads. If Facebook shows Renew, press it.");
ok("5: the how line lives in the top bar only", list.split("FACEBOOK_RENEW_HOW").length === 3);
const pe = read("app/dashboard/properties/[id]/publish-everywhere.tsx");
ok("8: no three old steps", !pe.includes("Approve each post") && !pe.includes("Confirm the live link") && !pe.includes(">\n                  Press Post"));
ok("8: no Posting chip before an ad is up", !pe.includes('copilot_fill: { label: "Posting"') && !pe.includes('paid_optin: { label: "Posting"'));
const signin = read("app/dashboard/site-signin/[channel]/page.tsx");
ok("9: signed in leads", signin.includes("You are signed in to ${name}") && signin.includes("Sign in again or use a different account"));
ok("10: kept private", signin.includes("kept private") && !signin.includes("locked with encryption"));
const today = read("app/dashboard/page.tsx");
ok("12: Today says renters", today.includes("        Recent renters\n") && !today.includes("        Recent inquiries\n"));
ok("12: Rentals says renters", list.includes('"renter" : "renters"') && list.includes(">Renters</p>"));
ok("12: your Vacantless page", read("app/dashboard/leads/triage-queue.tsx").includes('"your Vacantless page"'));
const detail = read("app/dashboard/properties/[id]/page.tsx");
ok("13: no 'link is saved' line", !detail.includes("once the link to your ad is saved"));
ok("15: photo folder one line", detail.includes("Photos in Google Drive or Dropbox? Paste the folder link and we pull them in."));
const advice = buildPostingAdvice([
  { source: "Zumper", leads: 6, booked: 2, showed: 0, leased: 0, leaseRate: 0 },
  { source: "Rentals.ca", leads: 6, booked: 0, showed: 0, leased: 0, leaseRate: 0 },
]);
ok("14: never calls Kijiji free", advice.every((a) => !/\bfree\b/i.test(a.text)));
ok("16: no inherits", !list.includes("Every unit inherits") && !/Every unit (in that building )?inherits/.test(read("app/dashboard/properties/standard-policy/page.tsx")));
ok("16: subtitle", list.includes("where each one is posted"));

console.log(`\ns806-wording: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
