import {
  buildAfterLiveSummary,
  listingPostTakenDown,
  type AfterLiveLeadRow,
  type AfterLiveListingPostRow,
} from "../lib/after-live-summary";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const lead = (overrides: Partial<AfterLiveLeadRow>): AfterLiveLeadRow => ({
  id: "lead_base",
  organization_id: "org_1",
  property_id: "prop_1",
  source: null,
  name: null,
  email: null,
  phone: null,
  created_at: null,
  ...overrides,
});

const post = (overrides: Partial<AfterLiveListingPostRow>): AfterLiveListingPostRow => ({
  portal: "kijiji",
  status: "live",
  created_at: null,
  ...overrides,
});

{
  const summary = buildAfterLiveSummary(
    [
      lead({
        id: "older",
        source: "Kijiji",
        name: "Priya Patel",
        created_at: "2026-07-24T10:00:00.000Z",
      }),
      lead({
        id: "newer",
        source: "Rentals.ca",
        name: null,
        email: "sam@example.com",
        created_at: "2026-07-25T10:00:00.000Z",
      }),
      lead({
        id: "unknown-channel",
        source: "   ",
        name: null,
        email: null,
        phone: "647-555-0101",
        created_at: "2026-07-23T10:00:00.000Z",
      }),
    ],
    [
      post({ portal: "rentals_ca", status: "removed" }),
      post({ portal: "kijiji", status: "live" }),
    ],
  );

  ok("leads are newest first", summary.leads.map((item) => item.id).join("|") === "newer|older|unknown-channel");
  ok("lead channel comes from source column", summary.leads[0]?.channel === "Rentals.ca");
  ok("blank lead source maps to null channel", summary.leads[2]?.channel === null);
  ok("lead contact falls back to email", summary.leads[0]?.name === "sam@example.com");
  ok("lead contact falls back to phone", summary.leads[2]?.name === "647-555-0101");
  ok("receivedOn keeps created_at", summary.leads[1]?.receivedOn === "2026-07-24T10:00:00.000Z");
  ok("removed post yields takenDown true", summary.channels[0]?.takenDown === true);
  ok("live post yields takenDown false", summary.channels[1]?.takenDown === false);
  ok("mixed live and removed ads are not leasedUp", summary.leasedUp === false);
}

{
  const summary = buildAfterLiveSummary(
    [],
    [
      post({ portal: "rentals_ca", status: "removed" }),
      post({ portal: "facebook_feed", status: "removed" }),
    ],
  );
  ok("all removed ads make leasedUp true", summary.leasedUp === true);
  ok("removed status helper returns true", listingPostTakenDown("removed") === true);
  ok("live status helper returns false", listingPostTakenDown("live") === false);
}

{
  const summary = buildAfterLiveSummary([], []);
  ok("no listing posts is not leasedUp", summary.leasedUp === false);
}

{
  const summary = buildAfterLiveSummary([], [post({ portal: "bad", status: "not_real" })]);
  ok("non-real post status is not surfaced as a channel", summary.channels.length === 0);
}

console.log(`\nafter-live-summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
