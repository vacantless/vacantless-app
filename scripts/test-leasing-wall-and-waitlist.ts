// Run with: npx tsx scripts/test-leasing-wall-and-waitlist.ts
// S710: leasing-only wall (lead page links, section guards, landlord campaign),
// waitlist move_in_by matching, showing-agent tier/service_area writes, and the
// welcome email's add-a-rental link.
import { readFileSync, existsSync } from "node:fs";
import { matchesVacancy, opensByMoveIn } from "../lib/waitlist";
import {
  nextRevealDue,
  revealAllowedForOrg,
  POST_LEASE_REVEAL_KEYS,
  LANDLORD_CAMPAIGN_START_MS,
  type LandlordRevealInput,
} from "../lib/landlord-campaign";
import { leasingOnlyNavEnabled, POST_LEASE_SECTIONS } from "../lib/post-lease-surface";
import { addRentalPath, decideOnboardingEmail } from "../lib/onboarding-emails";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// ---- 2. Waitlist move_in_by ------------------------------------------------
const entry = {
  status: "active",
  property_id: null,
  beds_min: null,
  max_rent_cents: null,
  last_notified_property_id: null,
};
const prop = { id: "P1", status: "available", beds: 2, rent_cents: 150000 };

ok("waitlist: no move_in_by, no date -> match", matchesVacancy(entry, prop));
ok("waitlist: move_in_by set, available now (null) -> match",
  matchesVacancy({ ...entry, move_in_by: "2026-11-01" }, { ...prop, available_date: null }));
ok("waitlist: move_in_by set, date omitted -> match",
  matchesVacancy({ ...entry, move_in_by: "2026-11-01" }, prop));
ok("waitlist: move_in_by before available date -> no match",
  !matchesVacancy({ ...entry, move_in_by: "2026-10-31" }, { ...prop, available_date: "2026-11-01" }));
ok("waitlist: move_in_by same day as available -> match",
  matchesVacancy({ ...entry, move_in_by: "2026-11-01" }, { ...prop, available_date: "2026-11-01" }));
ok("waitlist: move_in_by after available -> match",
  matchesVacancy({ ...entry, move_in_by: "2026-12-15" }, { ...prop, available_date: "2026-11-01" }));
ok("waitlist: no move_in_by, future date -> match",
  matchesVacancy({ ...entry, move_in_by: null }, { ...prop, available_date: "2027-01-01" }));
ok("waitlist: timestamp available_date compares by day",
  !matchesVacancy({ ...entry, move_in_by: "2026-10-31" }, { ...prop, available_date: "2026-11-01T00:00:00Z" }));
ok("waitlist: malformed move_in_by never excludes", opensByMoveIn("soon", "2026-11-01"));
ok("waitlist: other rules still apply",
  !matchesVacancy({ ...entry, status: "removed", move_in_by: "2027-01-01" }, prop));

// ---- 1c. Landlord campaign step filter -------------------------------------
ok("campaign: post-lease keys", ["rent_increase_confirm", "rent_collection", "tax_export"].every((k) => POST_LEASE_REVEAL_KEYS.has(k as never)));
ok("campaign: leasing keys stay", !POST_LEASE_REVEAL_KEYS.has("listing_marketing") && !POST_LEASE_REVEAL_KEYS.has("upgrade_ask"));
ok("campaign: walled blocks rent_collection", !revealAllowedForOrg("rent_collection", true));
ok("campaign: walled blocks tax_export", !revealAllowedForOrg("tax_export", true));
ok("campaign: walled keeps listing_marketing", revealAllowedForOrg("listing_marketing", true));
ok("campaign: walled keeps upgrade_ask", revealAllowedForOrg("upgrade_ask", true));
ok("campaign: not walled allows all", revealAllowedForOrg("rent_collection", false));

const DAY = 86_400_000;
const start = LANDLORD_CAMPAIGN_START_MS + 30 * DAY;
const baseInput: LandlordRevealInput = {
  campaignStartMs: start,
  nowMs: start + 60 * DAY,
  plan: "free",
  hasTenancy: true,
  enabled: true,
  optedOut: false,
  stepSent: 0,
  lastSentAtMs: null,
  hasRentCollection: false,
  hasTaxExport: false,
  hasListingMarketing: false,
};
ok("campaign: unwalled starts at rent_increase_confirm", nextRevealDue(baseInput)?.key === "rent_increase_confirm");
ok("campaign: explicit false is identical", nextRevealDue({ ...baseInput, postLeaseWalled: false })?.key === "rent_increase_confirm");
const walled = nextRevealDue({ ...baseInput, postLeaseWalled: true });
ok("campaign: walled skips to listing_marketing", walled?.key === "listing_marketing" && walled.index === 3);
ok("campaign: walled watermark past listing -> upgrade_ask",
  nextRevealDue({ ...baseInput, postLeaseWalled: true, stepSent: 4 })?.key === "upgrade_ask");

const cron = read("app/api/cron/landlord-campaign/route.ts");
ok("cron: reads the wall flag", cron.includes("leasingOnlyNavEnabled(deps.env)"));
ok("cron: passes postLeaseWalled to the live path and the dry path",
  (cron.match(/postLeaseWalled: isPostLeaseWalled\(org\.id\)/g) ?? []).length === 2);
ok("wall flag: env param", leasingOnlyNavEnabled({ LEASING_ONLY_NAV: "1" }) && !leasingOnlyNavEnabled({}));

// ---- 1a. Lead page tenancy links -------------------------------------------
const lead = read("app/dashboard/leads/[id]/page.tsx");
ok("lead: imports orgShowsPostLease", lead.includes('import { orgShowsPostLease } from "@/lib/post-lease-surface"'));
ok("lead: computes showPostLease", lead.includes("const showPostLease = org ? await orgShowsPostLease(supabase, org.id) : true;"));
ok("lead: gates create/convert links", lead.includes(') : !showPostLease ? null : l.status === "leased" ? ('));

// ---- 1b. Section guards -----------------------------------------------------
for (const section of POST_LEASE_SECTIONS) {
  const p = `app/dashboard/${section}/layout.tsx`;
  ok(`guard: ${section} has a layout`, existsSync(p));
  if (existsSync(p)) ok(`guard: ${section} layout calls the guard`, read(p).includes("await requirePostLeaseSurface();"));
}
const surface = read("lib/post-lease-surface.ts");
ok("guard: redirects walled orgs to Today", surface.includes('if (!show) redirect("/dashboard");'));
ok("guard: no-op when the flag is off", surface.includes("if (!leasingOnlyNavEnabled()) return;"));

// ---- 3. Showing agents ------------------------------------------------------
const sa = read("app/dashboard/showing-agents/actions.ts");
ok("agents: no tier write", !/tier:\s*check\.value\.tier/.test(sa) && !sa.includes('s(formData, "tier")'));
ok("agents: no service_area write", !/service_area:\s*check\.value\.service_area/.test(sa) && !sa.includes('s(formData, "service_area")'));
const me = read("app/dashboard/me/actions.ts");
ok("me: no service_area write", !/service_area:\s*check\.value\.service_area/.test(me) && !me.includes('formData.get("service_area")'));
const agentPage = read("app/agent/[token]/page.tsx");
ok("agent page: no tier label", agentPage.includes("agentDisplayLabel({ name: agent.name })") && !agentPage.includes("tier: agent.tier"));

// ---- 4. Welcome email link --------------------------------------------------
ok("welcome: flag off -> inline add form", addRentalPath(false) === "/dashboard/properties#add-rental");
ok("welcome: flag on -> new page", addRentalPath(true) === "/dashboard/properties/new");
ok("welcome: default email is safe",
  decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 0, stepSent: 0 })?.actionPath === "/dashboard/properties#add-rental");
ok("nudge: same gated link",
  decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 1, stepSent: 1, addPropertyV2Enabled: true })?.actionPath === "/dashboard/properties/new");
ok("welcome cron: passes the flag", read("app/api/cron/onboarding-emails/route.ts").includes("addPropertyV2Enabled: envFlagEnabled(process.env.ADD_PROPERTY_V2_ENABLED)"));

console.log(`\nleasing-wall-and-waitlist: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
