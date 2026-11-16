// S806 (REVIEW-S805 findings 6 and 7): renter emails are step 2 of the one
// sites page, a getting-started step, and a Today card; /dashboard/link-portals
// redirects to /dashboard/sites.
// Run: npx tsx scripts/test-renter-emails.ts
import { readFileSync } from "node:fs";
import {
  RENTER_EMAILS_HREF,
  hasRenterEmails,
  renterEmailNotices,
  sitesWithRenterEmails,
} from "../lib/renter-emails";
import { computeOnboardingState } from "../lib/onboarding-wizard";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- pure rules ---------------------------------------------------------------
ok("no events: nothing arrived", !hasRenterEmails([]));
ok("a lead counts", hasRenterEmails([{ source: "zumper", outcome: "lead_created" }]));
ok("a held scam counts", hasRenterEmails([{ source: "kijiji", outcome: "scam_held" }]));
ok("an unreadable email does not", !hasRenterEmails([{ source: "kijiji", outcome: "not_parsed" }]));
ok("gmail code is not a site", !sitesWithRenterEmails([{ source: "gmail_forwarding", outcome: "confirmation_code" }]).has("gmail_forwarding"));

const all = ["kijiji", "rentals_ca", "zumper"] as const;
ok("no live ads: no card", renterEmailNotices({ liveSites: [], enabledSites: [...all], events: [] }).length === 0);
const one = renterEmailNotices({ liveSites: ["zumper"], enabledSites: [...all], events: [] });
ok("live Zumper ad, nothing in: one card", one.length === 1);
ok("card names Zumper", one[0]?.title === "Renters who write on Zumper are not reaching you yet.");
ok("card opens the step", one[0]?.action.href === RENTER_EMAILS_HREF && RENTER_EMAILS_HREF === "/dashboard/sites#renter-emails");
const three = renterEmailNotices({ liveSites: ["kijiji", "rentals_ca", "zumper"], enabledSites: [...all], events: [] });
ok("three sites: one card", three.length === 1);
ok("three names joined", three[0]?.title.includes("Kijiji, Rentals.ca and Zumper"));
ok(
  "a site that delivered once is quiet",
  renterEmailNotices({ liveSites: ["zumper"], enabledSites: [...all], events: [{ source: "zumper", outcome: "lead_created" }] }).length === 0,
);
ok(
  "only the quiet site is named",
  renterEmailNotices({
    liveSites: ["kijiji", "zumper"],
    enabledSites: [...all],
    events: [{ source: "zumper", outcome: "duplicate" }],
  })[0]?.title === "Renters who write on Kijiji are not reaching you yet.",
);
ok(
  "a site the ingest does not read earns no card",
  renterEmailNotices({ liveSites: ["kijiji"], enabledSites: ["rentals_ca"], events: [] }).length === 0,
);
ok(
  "Agile today (all three delivered): no card",
  renterEmailNotices({
    liveSites: ["kijiji", "rentals_ca", "zumper"],
    enabledSites: [...all],
    events: all.map((source) => ({ source, outcome: "lead_created" })),
  }).length === 0,
);

// --- getting-started step -----------------------------------------------------
const base = {
  hasProperty: true,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: null,
  hasConnectedSite: true,
};
const without = computeOnboardingState(base);
ok("step hidden when the caller does not pass it", !without.steps.some((s) => s.key === "renter_emails"));
const todo = computeOnboardingState({ ...base, hasRenterEmails: false });
const keys = todo.steps.map((s) => s.key);
ok("step follows Connect your rental sites", keys.indexOf("renter_emails") === keys.indexOf("connect_sites") + 1);
const step = todo.steps.find((s) => s.key === "renter_emails");
ok("step is current after sites are connected", step?.status === "current");
ok("step opens the anchor", step?.href === "/dashboard/sites?from=getting-started#renter-emails");
ok("step is not optional", step?.optional !== true);
ok("done on the first renter email", computeOnboardingState({ ...base, hasRenterEmails: true }).steps.find((s) => s.key === "renter_emails")?.status === "complete");
ok("a tenanted account does not get it back", computeOnboardingState({ ...base, hasRenterEmails: false, hasTenancy: true }).steps.find((s) => s.key === "renter_emails")?.status === "complete");

// --- wiring -------------------------------------------------------------------
const sitesPage = read("app/dashboard/sites/page.tsx");
ok("sites page shows step 2", sitesPage.includes("<PortalInboxCard orgId={org.id} />") && sitesPage.includes("id={RENTER_EMAILS_ANCHOR}"));
ok("step 2 only with Posting", /access\.setup \? \(\s*\/\/ S806/.test(sitesPage));
ok("sites page runs the sign-in check", sitesPage.includes("<SiteChecks due={due} probeEnabled={vm.probeEnabled} />"));
ok("sites page no longer points at the old page", !sitesPage.includes('href="/dashboard/link-portals"'));
const rows = read("app/dashboard/sites/sites-rows.tsx");
ok("rows fold Details", rows.includes(">Details</summary>") && rows.includes("<ForgetSignin") && rows.includes("<KijijiTierPicker"));
const old = read("app/dashboard/link-portals/page.tsx");
ok("old page redirects", old.includes("redirect(`${SITES_SETUP_HREF}") && !old.includes("ConnectTiles"));
ok("old page keeps the rental", old.includes('params.set("property", property)'));
const actions = read("app/dashboard/link-portals/actions.ts");
ok("Get my address returns to the step", actions.includes('redirect("/dashboard/sites?address=ready#renter-emails")'));
const today = read("app/dashboard/page.tsx");
ok("Today shows the card", today.includes("...renterEmailCards]"));
const gs = read("app/dashboard/(wizard)/getting-started/page.tsx");
ok("getting-started passes the step", gs.includes("hasRenterEmails: renterEmailsDone"));
for (const f of [
  "app/agent/agent-actions.ts",
  "app/dashboard/settings/page.tsx",
  "app/dashboard/site-signin/[channel]/actions.ts",
  "app/dashboard/site-signin/[channel]/page.tsx",
  "app/dashboard/site-signin/page.tsx",
  "app/dashboard/send-live/page.tsx",
  "app/dashboard/add-details/page.tsx",
  "app/dashboard/properties/page.tsx",
  "app/api/cron/signin-lost/route.ts",
  "lib/onboarding.ts",
  "lib/onboarding-wizard.ts",
  "lib/sites-setup.ts",
]) {
  ok(`${f} links the one sites page`, !read(f).includes('"/dashboard/link-portals') && !read(f).includes("`/dashboard/link-portals"));
}
const en = JSON.parse(read("messages/en.json"));
ok("card title says renter emails", en.portalInbox.title === "Get renter emails here");

console.log(`\nrenter-emails: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
