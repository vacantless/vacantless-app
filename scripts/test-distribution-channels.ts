// Unit tests for the pure distribution-channels matrix + status reducer.
// Run: npx tsx scripts/test-distribution-channels.ts
import {
  CHANNEL_MODES,
  DISTRIBUTION_CHANNELS,
  channelByKey,
  channelModeLabel,
  CHANNEL_STATUS_VALUES,
  channelStatusLabel,
  channelStatusTone,
  DEFAULT_REFRESH_DAYS,
  daysBetween,
  computeChannelStatus,
  type ChannelPost,
} from "../lib/distribution-channels";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- matrix ----------------------------------------------------------------
ok("6 channels in the matrix", DISTRIBUTION_CHANNELS.length === 6);
ok(
  "matrix excludes 'other'",
  !DISTRIBUTION_CHANNELS.some((c) => (c.key as string) === "other"),
);
ok(
  "facebook is first (highest demand)",
  DISTRIBUTION_CHANNELS[0].key === "facebook",
);
ok("channelByKey resolves kijiji", channelByKey("kijiji")?.label === "Kijiji");
ok("channelByKey junk -> null", channelByKey("nope") === null);
ok("channelByKey other -> null (not a matrix row)", channelByKey("other") === null);

// Every channel keeps its wiring coherent.
for (const c of DISTRIBUTION_CHANNELS) {
  ok(`${c.key}: mode is valid`, (CHANNEL_MODES as readonly string[]).includes(c.mode));
  ok(`${c.key}: portalUrl is https`, /^https:\/\//.test(c.portalUrl));
  ok(`${c.key}: has a blurb`, c.blurb.length > 20);
  ok(`${c.key}: no em dashes in blurb`, !/[—–]/.test(c.blurb));
}

// Copy/feed/mode facts the plan pins down.
ok("realtor_ca is broker mode", channelByKey("realtor_ca")?.mode === "broker");
ok("realtor_ca has NO self-serve copy", channelByKey("realtor_ca")?.copyKey === null);
ok("facebook copyKey = facebook", channelByKey("facebook")?.copyKey === "facebook");
ok("facebook is assisted_manual", channelByKey("facebook")?.mode === "assisted_manual");
ok("rentals_ca is feed-eligible", channelByKey("rentals_ca")?.feedEligible === true);
ok("zumper is feed-eligible", channelByKey("zumper")?.feedEligible === true);
ok("facebook is NOT feed-eligible", channelByKey("facebook")?.feedEligible === false);
ok("kijiji is NOT feed-eligible", channelByKey("kijiji")?.feedEligible === false);
ok(
  "all matrix channels have a fill sheet",
  DISTRIBUTION_CHANNELS.every((c) => c.hasFillSheet),
);
ok(
  "all matrix channels have guardrails",
  DISTRIBUTION_CHANNELS.every((c) => c.hasGuardrails),
);

// --- labels ----------------------------------------------------------------
ok("modeLabel broker", channelModeLabel("broker") === "Broker / MLS");
ok("modeLabel junk -> default", channelModeLabel("???") === "Guided posting");
ok("statusLabel posted", channelStatusLabel("posted") === "Posted");
ok("statusLabel needs_refresh", channelStatusLabel("needs_refresh") === "Needs refresh");
ok("statusLabel junk -> Not started", channelStatusLabel("???") === "Not started");
ok("5 status values", CHANNEL_STATUS_VALUES.length === 5);
ok("tone posted = positive", channelStatusTone("posted") === "positive");
ok("tone needs_refresh = warning", channelStatusTone("needs_refresh") === "warning");
ok("tone problem = danger", channelStatusTone("problem") === "danger");
ok("tone not_started = neutral", channelStatusTone("not_started") === "neutral");

// --- daysBetween -----------------------------------------------------------
ok("daysBetween same day = 0", daysBetween("2026-07-04", "2026-07-04") === 0);
ok("daysBetween 14 days", daysBetween("2026-06-20", "2026-07-04") === 14);
ok("daysBetween invalid -> null", daysBetween("nope", "2026-07-04") === null);
ok("daysBetween null -> null", daysBetween(null, "2026-07-04") === null);

// --- computeChannelStatus --------------------------------------------------
const TODAY = "2026-07-04";
const live = (posted_on: string | null, url = "https://kijiji.ca/x", inquiryCount = 0): ChannelPost => ({
  status: "live",
  url,
  posted_on,
  inquiryCount,
});

// No posts, listing live, no blockers -> ready.
{
  const s = computeChannelStatus({ linkIsLive: true, blockers: [], posts: [], today: TODAY });
  ok("no posts + ready listing -> ready", s.value === "ready");
  ok("ready has no blockers", s.blockers.length === 0);
}

// No posts, listing NOT live -> not_started + the Set-Live blocker leads.
{
  const s = computeChannelStatus({ linkIsLive: false, blockers: [], posts: [], today: TODAY });
  ok("not live + no posts -> not_started", s.value === "not_started");
  ok("not live injects the Set-Live blocker", s.blockers[0].includes("Set this rental Live"));
}

// No posts, listing live, but has readiness blockers -> not_started.
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: ["Add photos"],
    posts: [],
    today: TODAY,
  });
  ok("blockers + no posts -> not_started", s.value === "not_started");
  ok("blockers carried through", s.blockers.includes("Add photos"));
}

// Fresh live post -> posted.
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [live("2026-07-01", "https://kijiji.ca/ad", 3)],
    today: TODAY,
  });
  ok("fresh live -> posted", s.value === "posted");
  ok("posted surfaces the live url", s.liveUrl === "https://kijiji.ca/ad");
  ok("posted lastPostedOn set", s.lastPostedOn === "2026-07-01");
  ok("inquiryCount summed", s.inquiryCount === 3);
}

// Stale live post (>= refreshDays) -> needs_refresh.
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [live("2026-06-15")],
    today: TODAY,
  });
  ok("stale live -> needs_refresh", s.value === "needs_refresh");
  ok("needs_refresh keeps the url", s.liveUrl === "https://kijiji.ca/x");
}

// Exactly at the threshold -> needs_refresh (>= is inclusive).
{
  const at = "2026-06-20"; // 14 days before TODAY
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [live(at)],
    today: TODAY,
  });
  ok(`at ${DEFAULT_REFRESH_DAYS}d threshold -> needs_refresh`, s.value === "needs_refresh");
}

// Live post with no posted_on date -> posted (can't be judged stale).
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [live(null)],
    today: TODAY,
  });
  ok("live w/o date -> posted (not stale)", s.value === "posted");
}

// Live post missing url -> problem.
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [{ status: "live", url: null, posted_on: "2026-07-01", inquiryCount: 0 }],
    today: TODAY,
  });
  ok("live w/o url -> problem", s.value === "problem");
  ok("problem liveUrl null", s.liveUrl === null);
}

// Expired/removed, nothing live -> needs_refresh (repost).
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [{ status: "expired", url: "https://x.ca/a", posted_on: "2026-06-01", inquiryCount: 2 }],
    today: TODAY,
  });
  ok("expired -> needs_refresh", s.value === "needs_refresh");
  ok("expired keeps inquiry tally", s.inquiryCount === 2);
}

// Draft only -> ready (a plan noted).
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [{ status: "draft", url: null, posted_on: null, inquiryCount: 0 }],
    today: TODAY,
  });
  ok("draft only -> ready", s.value === "ready");
}

// A live post wins over a draft; picks the most recent live one for the link.
{
  const s = computeChannelStatus({
    linkIsLive: true,
    blockers: [],
    posts: [
      live("2026-07-01", "https://x.ca/old", 1),
      live("2026-07-03", "https://x.ca/new", 4),
      { status: "draft", url: null, posted_on: null, inquiryCount: 0 },
    ],
    today: TODAY,
  });
  ok("most-recent live chosen", s.liveUrl === "https://x.ca/new");
  ok("lastPostedOn = most recent", s.lastPostedOn === "2026-07-03");
  ok("inquiry tally sums all posts", s.inquiryCount === 5);
}

// Live post present but listing not live -> still posted, but Set-Live blocker warns.
{
  const s = computeChannelStatus({
    linkIsLive: false,
    blockers: [],
    posts: [live("2026-07-03")],
    today: TODAY,
  });
  ok("live post + listing not live -> posted", s.value === "posted");
  ok("not-live blocker still surfaced as a warning", s.blockers.some((b) => b.includes("Set this rental Live")));
}

// Set-Live blocker not duplicated if caller already passed one.
{
  const s = computeChannelStatus({
    linkIsLive: false,
    blockers: ["Set this rental Live so its inquiry link works"],
    posts: [],
    today: TODAY,
  });
  ok(
    "Set-Live blocker de-duplicated",
    s.blockers.filter((b) => b.includes("Set this rental Live")).length === 1,
  );
}

// ---------------------------------------------------------------------------
console.log(`\ndistribution-channels: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
