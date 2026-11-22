// S830d: "Set up your phone and computer" with "Have someone set it up for me" (PLAN-S829 item 2b).
// Run: npx tsx scripts/test-s830d-set-up-my-tools.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeOnboardingState } from "../lib/onboarding-wizard";
import { teamInviteHtml, teamInviteSetupHtml } from "../lib/email";
import { MARKETPLACE_HELPER_INSTALL_URL } from "../lib/marketplace-helper";

let n = 0;
const ok = (c: boolean, m: string) => {
  assert.ok(c, m);
  n++;
};

const state = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: true,
  hasTenancy: false,
  wizardEnabled: false,
  railStepDoneAt: null,
  dismissedAt: null,
  hasLead: true,
  hasPhoneReplies: false,
});
const step = state.steps.find((s) => s.key === "phone_replies")!;
ok(step.label === "Set up your phone and computer", "one step for both tools");
ok(/Chrome on a computer, not on a phone/.test(step.description), "says the helper does not run on a phone");
ok(step.helpCta === "Have someone set it up for me" && step.helpHref === "/dashboard/settings?tab=team&helpsetup=1#add-teammate", "second button opens the invite");
ok(!/[—–]/.test(step.description + step.label), "no dashes");

const page = readFileSync("app/dashboard/(wizard)/getting-started/page.tsx", "utf8");
ok(page.includes("step.helpHref && step.helpCta && !isComplete"), "Getting started shows the second button until done");
const settings = readFileSync("app/dashboard/settings/page.tsx", "utf8");
ok(settings.includes('setup={searchParams.helpsetup === "1"}'), "settings passes helpsetup (setup is the message-setup flash)");
const team = readFileSync("app/dashboard/settings/team-section.tsx", "utf8");
ok(team.includes('id="add-teammate"') && team.includes('name="purpose" value="setup"'), "team card anchor and purpose field");
const actions = readFileSync("app/dashboard/settings/team-actions.ts", "utf8");
ok(actions.includes('formData.get("purpose")') && actions.includes('=== "setup"'), "invite action reads the purpose");

const base = { to_email: "kid@example.com", org_name: "Maple Rentals", inviter_email: "owner@example.com", role_label: "Teammate", token: "tok" };
const plain = teamInviteHtml(base);
const withSetup = teamInviteHtml({ ...base, setup: true });
ok(!plain.includes("set up two tools"), "a normal invite has no setup block");
ok(withSetup.includes("set up two tools") && withSetup.includes("Show a code for my phone"), "setup invite explains the phone");
ok(withSetup.includes(MARKETPLACE_HELPER_INSTALL_URL) && /not on a phone/.test(teamInviteSetupHtml()), "setup invite links the Chrome helper");
ok(!/[—–]/.test(teamInviteSetupHtml()), "no dashes in the email block");

console.log(`s830d set up my tools: ${n} passed, 0 failed`);
