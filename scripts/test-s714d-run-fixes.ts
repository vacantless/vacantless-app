// S714d: the fixes from S714's new-landlord run on the live site.
// Run: npx tsx scripts/test-s714d-run-fixes.ts
import { readFileSync } from "node:fs";
import {
  EXISTING_ACCOUNT_MESSAGE,
  onboardingNextStep,
  signupEyebrow,
  signupHitExistingAccount,
  signupSubtitle,
} from "../lib/signup-copy";
import { RELIST_MIN_DAYS, showRelistButton } from "../lib/relist-visibility";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// 2. Existing account on sign-up.
ok("'already registered' is an existing account", signupHitExistingAccount({ errorMessage: "User already registered", hasUser: false }));
ok("no identities is an existing account", signupHitExistingAccount({ errorMessage: null, identitiesCount: 0, hasUser: true }));
ok("a new user is not", !signupHitExistingAccount({ errorMessage: null, identitiesCount: 1, hasUser: true }));
ok("a weak-password error is not", !signupHitExistingAccount({ errorMessage: "Password should be at least 6 characters", hasUser: false }));
ok("existing-account message points to Log in", /Log in instead/.test(EXISTING_ACCOUNT_MESSAGE));
const signup = read("app/signup/page.tsx");
ok("sign-up page shows who is signed in", signup.includes("You're already signed in") && signup.includes("Sign out and create a new login"));
ok("sign-up page checks for an existing account before other errors", signup.indexOf("signupHitExistingAccount(") < signup.indexOf("setError(error.message)"));

// 6. Headers follow the plan picked.
ok("growth header", signupEyebrow("growth") === "Growth plan");
ok("free header", signupEyebrow(null) === "Start free" && signupEyebrow("free") === "Start free");
ok("growth subtitle drops 'no credit card'", !/No credit card/.test(signupSubtitle("growth")) && /No credit card/.test(signupSubtitle(null)));
ok("onboarding names the pay step for growth", /choose how to pay/.test(onboardingNextStep("growth")));
ok("onboarding free next step unchanged", onboardingNextStep(undefined) === "Next: add your first rental.");
ok("onboarding page uses the helper", read("app/onboarding/page.tsx").includes("onboardingNextStep(searchParams.plan)"));

// 3. Set Live dialog says what it does.
const confirm = read("app/dashboard/properties/[id]/confirm-publish-button.tsx");
ok("dialog title is about the page", confirm.includes('"Put your rental page online"') && !confirm.includes('"Post this rental"'));
ok("dialog button is 'Put it online'", confirm.includes('"Put it online"') && !confirm.includes('"Post it"'));

// 4. No "Relist / refresh" on a rental that just went live.
const now = new Date("2026-10-14T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const base = { enabled: true, leased: false, bookable: true, missingRequired: 0, now };
ok("just live: hidden", !showRelistButton({ ...base, availableSince: new Date(now.getTime() - 60_000).toISOString() }));
ok(`live ${RELIST_MIN_DAYS} days: shown`, showRelistButton({ ...base, availableSince: new Date(now.getTime() - RELIST_MIN_DAYS * day).toISOString() }));
ok("unknown start: shown (older rentals keep it)", showRelistButton({ ...base, availableSince: null }));
ok("leased: shown", showRelistButton({ ...base, leased: true, bookable: false, availableSince: now.toISOString() }));
ok("flag off: hidden", !showRelistButton({ ...base, enabled: false, availableSince: null }));
ok("not ready: hidden", !showRelistButton({ ...base, missingRequired: 1, availableSince: null }));
ok("rental page uses the helper", read("app/dashboard/properties/[id]/page.tsx").includes("showRelistButton({"));

// 5. No doubled "page is live" line.
const pe = read("app/dashboard/properties/[id]/publish-everywhere.tsx");
ok("'live too' only when a site is live", pe.includes('proofSavedCount > 0 ? "Your Vacantless page is live too. " : ""'));

// 7. Free Facebook Page posting is named.
ok("homepage Free plan names Facebook Page", read("app/page.tsx").includes('"Posts to your Facebook Page, free"'));
const wiz = read("lib/onboarding-wizard.ts");
ok("checklist names Facebook Page and Posting", /Facebook Page for free/.test(wiz) && /With Posting, we post it to Kijiji, Rentals.ca and Zumper/.test(wiz)); // S717: Rentals.ca for every landlord
ok("checklist step still never names Marketplace (S710 rule)", !/Marketplace/.test(wiz.slice(wiz.indexOf('key: "get_online"'), wiz.indexOf('key: "tenancy"'))));
ok("checklist no longer promises Kijiji/Zumper to everyone", !wiz.includes("Then we post it to Kijiji or Zumper for you."));

// 8. Checkbox row wraps.
ok("add-rental checkboxes wrap across the row", read("app/dashboard/properties/new/add-property-form.tsx").includes("flex flex-wrap items-end gap-x-4 gap-y-2 sm:col-span-3"));

// 9. Viewings empty box knows hours are set.
const sh = read("app/dashboard/showings/page.tsx");
ok("viewings page counts viewing times", sh.includes("countViewingTimes(supabase, org.id, timeZone)"));
ok("empty box has a set-hours message", sh.includes("Your viewing hours are set."));

// 10. Booked screen mentions the text.
const act = read("app/r/[propertyId]/actions.ts");
ok("booking reports a sent text", act.includes("texted = true;") && act.includes("return { booked, slotTaken, texted };"));
ok("both redirects carry texted", (act.match(/texted=1/g) ?? []).length >= 2);
ok("renter page says emailed and texted", read("app/r/[propertyId]/page.tsx").includes("We've emailed and texted you the details."));

console.log(`\ns714d-run-fixes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
