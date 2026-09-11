// What a landlord is allowed to see, decided from the record. Fixtures mirror
// the real PROD shapes as at 2026-09-11.
// Run: npx tsx scripts/test-channel-provenness.ts
import {
  channelEvidence,
  shownChannels,
  channelPostedByLabel,
  DEFAULT_FRESHNESS_DAYS,
  showOnlyProvenChannelsEnabled,
  NON_PRODUCTION_ORGANIZATION_IDS,
  type ChannelLivePostRow,
  type ChannelVerificationRow,
} from "@/lib/channel-provenness";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const ASOF = "2026-09-11";
const AGILE = "org-agile";
const ABBAS = "org-abbas";
const DAVIS = "org-davis";
const GROWTH_TEST = "org-growth-test";
const NORTHSTAR_QA = "org-northstar-qa";
// Both of these are ours. Neither is a customer.
const TEST_ORGS = [GROWTH_TEST, NORTHSTAR_QA];

// A machine check: nobody recorded it by hand.
const machine = (channel: string, on: string, type = "external_url", transport: string | null = "concierge", org: string | null = AGILE): ChannelVerificationRow =>
  ({ channel, result: "verified_live", verificationType: type, checkedBy: null, checkedOn: on, transport, organizationId: org });
const human = (channel: string, on: string, type = "manual_concierge", transport: string | null = "concierge", org: string | null = AGILE): ChannelVerificationRow =>
  ({ channel, result: "verified_live", verificationType: type, checkedBy: "user-1", checkedOn: on, transport, organizationId: org });
const post = (channel: string, org: string | null): ChannelLivePostRow =>
  ({ channel, organizationId: org, hasUrl: true });

// The record as it actually stands, with every row in the organization that
// really holds it. That last part is the whole fixture: the first version of
// this file put Kijiji's machine checks in a customer org when PROD has all
// three inside Growth Test, and the suite passed while the module was wrong.
const verifications: ChannelVerificationRow[] = [
  // Vacantless page: checked in two customer orgs and in both of ours.
  ...Array.from({ length: 5 }, () => machine("vacantless", "2026-09-06", "public_page", "automatic", ABBAS)),
  ...Array.from({ length: 3 }, () => machine("vacantless", "2026-09-06", "public_page", "automatic", AGILE)),
  ...Array.from({ length: 7 }, () => machine("vacantless", "2026-09-06", "public_page", "automatic", GROWTH_TEST)),
  ...Array.from({ length: 4 }, () => machine("vacantless", "2026-09-06", "public_page", "automatic", NORTHSTAR_QA)),
  ...Array.from({ length: 4 }, () => machine("rentals_ca", "2026-09-06", "external_url", "concierge", AGILE)),
  // All three Kijiji machine checks happened inside Growth Test.
  ...Array.from({ length: 3 }, () => machine("kijiji", "2026-08-14", "external_url", "concierge", GROWTH_TEST)),
  // Kijiji's other two wins came by the deleted co-pilot, in the QA org.
  human("kijiji", "2026-07-13", "external_url", "browser_copilot", NORTHSTAR_QA),
  human("kijiji", "2026-07-13", "external_url", "browser_copilot", NORTHSTAR_QA),
  ...Array.from({ length: 4 }, () => human("zumper", "2026-09-06", "manual_concierge", "concierge", AGILE)),
  // The Meta channels have only ever been confirmed inside Growth Test.
  ...Array.from({ length: 3 }, () => human("facebook_feed", "2026-08-16", "external_url", "automatic", GROWTH_TEST)),
  ...Array.from({ length: 2 }, () => human("instagram", "2026-08-16", "external_url", "automatic", GROWTH_TEST)),
  // org_feed only ever reaches submitted. Submitted is not live.
  { channel: "org_feed", result: "verified_submitted", verificationType: "feed_render", checkedBy: null, checkedOn: "2026-09-07", transport: "automatic", organizationId: AGILE },
];

const livePosts: ChannelLivePostRow[] = [
  post("rentals_ca", AGILE), post("rentals_ca", AGILE), post("rentals_ca", AGILE),
  post("kijiji", AGILE), post("kijiji", AGILE),
  post("zumper", AGILE), post("zumper", AGILE), post("zumper", AGILE), post("zumper", AGILE),
  post("zumper", ABBAS), post("zumper", DAVIS),
  // Facebook Marketplace: four rows say live and nothing has ever confirmed one.
  post("facebook", AGILE), post("facebook", AGILE), post("facebook", AGILE), post("facebook", DAVIS),
  // The API channels have only ever gone live in the test org.
  post("facebook_feed", GROWTH_TEST), post("facebook_feed", GROWTH_TEST),
  post("instagram", GROWTH_TEST),
];

const ev = channelEvidence({ verifications, livePosts, asOf: ASOF, testOrganizationIds: TEST_ORGS });
const of = (c: string) => ev.find((e) => e.channel === c)!;

// --- A. The verdicts -------------------------------------------------------
{
  ok("vacantless is proven", of("vacantless").provenness === "proven");
  ok("rentals.ca is proven", of("rentals_ca").provenness === "proven");
  ok("kijiji is NOT proven: every machine check was in our own test org", of("kijiji").provenness === "unproven");
  ok("zumper is assisted, not proven", of("zumper").provenness === "assisted");
  ok("facebook page feed is unproven: confirmed only in our test org", of("facebook_feed").provenness === "unproven");
  ok("instagram is unproven: confirmed only in our test org", of("instagram").provenness === "unproven");
  ok("facebook marketplace is unproven", of("facebook").provenness === "unproven");
  ok("org feed is unproven", of("org_feed").provenness === "unproven");
}

// --- B. The rules that produce those verdicts ------------------------------
{
  ok("a person's check never makes a channel proven", of("zumper").machineVerifications === 0 && of("zumper").humanVerifications === 4);
  ok("zumper still has the widest reach", of("zumper").adsLiveNow === 6 && of("zumper").orgsWithLiveAds === 3);
  ok(
    "marketplace has live rows and no confirmation at all",
    of("facebook").adsLiveNow === 4 && of("facebook").machineVerifications === 0 && of("facebook").humanVerifications === 0,
  );
  ok("marketplace says plainly that nothing was ever confirmed", of("facebook").reason.includes("No confirmed live ad, ever"));
  ok("submitted is never counted as live", of("org_feed").machineVerifications === 0 && of("org_feed").humanVerifications === 0);
  ok(
    "a win in a test org does not count as a live ad",
    of("facebook_feed").adsLiveNow === 0 && of("instagram").adsLiveNow === 0,
  );
  ok("kijiji counts none of the three test-org machine checks", of("kijiji").machineVerifications === 0);
  ok("the retired co-pilot wins are excluded", of("kijiji").humanVerifications === 0);
  ok("kijiji still shows its two real live ads", of("kijiji").adsLiveNow === 2);
  ok(
    "kijiji says the confirmations were ours, not that there were none",
    of("kijiji").reason.includes("an account we run ourselves"),
  );
  ok("vacantless counts only the eight customer checks", of("vacantless").machineVerifications === 8);
  ok("vacantless is proven on customer evidence alone", of("vacantless").provenness === "proven");
}

// --- C. A win by a deleted route cannot prove anything ---------------------
{
  const only = channelEvidence({
    verifications: [
      human("kijiji", "2026-09-01", "external_url", "browser_copilot"),
      machine("kijiji", "2026-09-01", "external_url", "browser_copilot"),
    ],
    livePosts: [post("kijiji", AGILE)],
    asOf: ASOF,
  });
  ok("retired route only: unproven", only[0].provenness === "unproven");
  ok("retired route only: says nobody can repeat it", only[0].reason.includes("has since been removed"));

  // A channel with BOTH a dead-route win and a surviving-route win is stale, not
  // unrepeatable. Saying "the route was removed" there sends the reader to fix
  // the wrong thing.
  const mixed = channelEvidence({
    verifications: [
      machine("kijiji", "2026-01-05", "external_url", "concierge"),
      machine("kijiji", "2026-01-05", "external_url", "browser_copilot"),
    ],
    livePosts: [],
    asOf: ASOF,
  });
  ok("mixed routes: unproven because stale", mixed[0].provenness === "unproven");
  ok("mixed routes: blamed on the window, not the deleted route", mixed[0].reason.includes(`last ${DEFAULT_FRESHNESS_DAYS} days`));
  ok("retired route only: it is not shown", shownChannels(only).length === 0);
}

// --- D. Proven decays ------------------------------------------------------
{
  const later = channelEvidence({ verifications, livePosts, asOf: "2027-01-01", testOrganizationIds: TEST_ORGS });
  const r = later.find((e) => e.channel === "rentals_ca")!;
  const z = later.find((e) => e.channel === "zumper")!;
  ok("decay: rentals.ca falls out of the window", r.provenness === "unproven");
  ok("decay: zumper falls out of the window", z.provenness === "unproven");
  ok("decay: it says the window is why", r.reason.includes(`last ${DEFAULT_FRESHNESS_DAYS} days`));
  ok("decay: nothing is shown once everything is stale", shownChannels(later).length === 0);

  // The window is a knob, and a wider one keeps them.
  const wide = channelEvidence({ verifications, livePosts, asOf: "2027-01-01", freshnessDays: 365, testOrganizationIds: TEST_ORGS });
  ok("decay: a wider window keeps them proven", wide.find((e) => e.channel === "rentals_ca")!.provenness === "proven");
}

// --- E. What the landlord sees --------------------------------------------
{
  const shown = shownChannels(ev);
  ok("shown: only the three with customer evidence", shown.length === 3);
  ok("shown: they are the vacantless page, rentals.ca and zumper", shown.join(",") === "vacantless,rentals_ca,zumper");
  ok("shown: kijiji is absent despite two live ads", !shown.includes("kijiji"));
  ok("shown: the Meta channels are absent", !shown.includes("facebook_feed") && !shown.includes("instagram"));
  ok("shown: marketplace is absent", !shown.includes("facebook"));
  ok("shown: org feed is absent", !shown.includes("org_feed"));
  ok("shown: a channel with no record at all never appears", !shown.includes("viewit") && !shown.includes("linkedin"));
  ok("shown: proven come first", shown[0] === "vacantless");
  ok("label: proven says we check it", channelPostedByLabel(of("rentals_ca")) === "Posted and checked by us");
  ok("label: assisted never claims automatic", channelPostedByLabel(of("zumper")) === "Posted by us, checked by hand");
  ok("label: unproven is not offered", channelPostedByLabel(of("facebook")) === "Not offered");
}

// --- F. The rule can also say yes ------------------------------------------
// A guard that only ever hides things proves nothing.
{
  const fresh = channelEvidence({
    verifications: [machine("viewit", "2026-09-10", "external_url", "concierge")],
    livePosts: [post("viewit", AGILE)],
    asOf: ASOF,
  });
  ok("a brand new channel with one machine check IS shown", fresh[0].provenness === "proven" && shownChannels(fresh)[0] === "viewit");
}

// --- G. Edges --------------------------------------------------------------
{
  const none = channelEvidence({ verifications: [], livePosts: [], asOf: ASOF });
  ok("no data at all: nothing to show, no crash", none.length === 0 && shownChannels(none).length === 0);

  const future = channelEvidence({
    verifications: [machine("kijiji", "2027-05-01")],
    livePosts: [],
    asOf: ASOF,
  });
  ok("a check dated in the future is not trusted", future[0].provenness === "unproven");

  const noUrl = channelEvidence({
    verifications: [machine("zumper", "2026-09-06")],
    livePosts: [{ channel: "zumper", organizationId: AGILE, hasUrl: false }],
    asOf: ASOF,
  });
  ok("a live row with no url is not an ad", noUrl[0].adsLiveNow === 0);
}

// --- H. The test-org gate, on BOTH inputs ----------------------------------
// This is the section that would have caught the defect the real PROD rows
// found: the first version excluded test orgs from live posts and counted them
// on verifications, which promoted Kijiji to "proven" on our own work.
{
  const verifs = [machine("kijiji", "2026-09-10", "external_url", "concierge", GROWTH_TEST)];
  const posts = [post("kijiji", GROWTH_TEST)];

  const gated = channelEvidence({ verifications: verifs, livePosts: posts, asOf: ASOF, testOrganizationIds: TEST_ORGS });
  ok("gate: a test-org machine check does not prove a channel", gated[0].provenness === "unproven");
  ok("gate: a test-org live row is not an ad", gated[0].adsLiveNow === 0);
  ok("gate: the same org is excluded on both inputs", gated[0].machineVerifications === 0 && gated[0].adsLiveNow === 0);

  // And it must be able to say yes: the identical rows in a customer org pass.
  const real = channelEvidence({
    verifications: [machine("kijiji", "2026-09-10", "external_url", "concierge", AGILE)],
    livePosts: [post("kijiji", AGILE)],
    asOf: ASOF,
    testOrganizationIds: TEST_ORGS,
  });
  ok("gate: the same evidence in a customer org IS proven", real[0].provenness === "proven" && real[0].adsLiveNow === 1);

  // An unattributable row is not evidence either, on either input.
  const orphan = channelEvidence({
    verifications: [machine("kijiji", "2026-09-10", "external_url", "concierge", null)],
    livePosts: [post("kijiji", null)],
    asOf: ASOF,
    testOrganizationIds: TEST_ORGS,
  });
  ok("gate: a row with no organization counts on neither input", orphan[0].provenness === "unproven" && orphan[0].adsLiveNow === 0);

  // Passing no list at all must not silently trust everything we know is ours:
  // it trusts the caller, so the caller is what the wiring test pins.
  const ungated = channelEvidence({ verifications: verifs, livePosts: posts, asOf: ASOF });
  ok("gate: with no list supplied the rows do count, so the caller must supply it", ungated[0].provenness === "proven");
}

// --- I. The flag and the org list -----------------------------------------
// The flag is dark until the Meta verdict, so the OFF path is the one that
// ships first and the one that must be right.
{
  ok("flag: unset is off", showOnlyProvenChannelsEnabled(undefined) === false);
  ok("flag: empty is off", showOnlyProvenChannelsEnabled("") === false);
  ok("flag: 0 and false are off", !showOnlyProvenChannelsEnabled("0") && !showOnlyProvenChannelsEnabled("false"));
  ok(
    "flag: 1, true and yes are on, case and spacing tolerant",
    showOnlyProvenChannelsEnabled("1") &&
      showOnlyProvenChannelsEnabled("true") &&
      showOnlyProvenChannelsEnabled(" YES ") &&
      showOnlyProvenChannelsEnabled("True"),
  );
  ok(
    "the non-production list carries both of our own orgs",
    NON_PRODUCTION_ORGANIZATION_IDS.length === 2 &&
      new Set(NON_PRODUCTION_ORGANIZATION_IDS).size === 2,
  );
  ok(
    "every id in the list is a uuid, so a typo cannot silently match nothing",
    NON_PRODUCTION_ORGANIZATION_IDS.every((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
    ),
  );
}

console.log(failed === 0 ? `PASS ${passed}/${passed + failed}` : `FAIL ${failed} of ${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
