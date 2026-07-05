// Unit tests for the pure distribution-analytics helpers.
// Run: npx tsx scripts/test-distribution-analytics.ts
import {
  channelSuggestion,
  computeChannelAnalytics,
  analyticsTotals,
  type LeadLite,
  type PostLite,
} from "../lib/distribution-analytics";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TODAY = "2026-07-04";

// --- channelSuggestion -----------------------------------------------------
ok(
  "no live post + no leads -> post it",
  /Post it to start/.test(
    channelSuggestion({ leads: 0, advanced: 0, hasLivePost: false, daysLive: null }),
  ),
);
ok(
  "no live post + past leads -> repost",
  /repost/.test(
    channelSuggestion({ leads: 3, advanced: 1, hasLivePost: false, daysLive: null }),
  ),
);
ok(
  "live, 0 leads, >=14d -> refresh",
  /refresh the ad/.test(
    channelSuggestion({ leads: 0, advanced: 0, hasLivePost: true, daysLive: 20 }),
  ),
);
ok(
  "live, 0 leads, fresh -> give it a few days",
  /give it a few days/.test(
    channelSuggestion({ leads: 0, advanced: 0, hasLivePost: true, daysLive: 3 }),
  ),
);
ok(
  "leads but 0 advanced -> reply faster",
  /reply faster/.test(
    channelSuggestion({ leads: 5, advanced: 0, hasLivePost: true, daysLive: 5 }),
  ),
);
ok(
  "leads + advanced -> working",
  /Working/.test(
    channelSuggestion({ leads: 5, advanced: 2, hasLivePost: true, daysLive: 5 }),
  ),
);
ok(
  "no em dashes in suggestions",
  !/[—–]/.test(
    [
      channelSuggestion({ leads: 0, advanced: 0, hasLivePost: false, daysLive: null }),
      channelSuggestion({ leads: 0, advanced: 0, hasLivePost: true, daysLive: 20 }),
      channelSuggestion({ leads: 5, advanced: 0, hasLivePost: true, daysLive: 5 }),
    ].join(" "),
  ),
);

// --- computeChannelAnalytics ----------------------------------------------
const posts: PostLite[] = [
  { id: "pk", portal: "kijiji", status: "live", posted_on: "2026-06-30" },
  { id: "pf", portal: "facebook", status: "live", posted_on: "2026-06-01" },
  { id: "pz", portal: "zumper", status: "expired", posted_on: "2026-05-01" },
];
const leads: LeadLite[] = [
  { listing_post_id: "pf", status: "booked" }, // facebook advanced
  { listing_post_id: "pf", status: "new" }, // facebook raw
  { listing_post_id: "pk", status: "new" }, // kijiji raw
  { listing_post_id: null, status: "new" }, // untracked
  { listing_post_id: "unknown", status: "leased" }, // stale/unknown post -> untracked
];

const rows = computeChannelAnalytics({ leads, posts, today: TODAY });
{
  const fb = rows.find((r) => r.channel === "facebook")!;
  ok("facebook 2 leads", fb.leads === 2);
  ok("facebook 1 advanced", fb.advanced === 1);
  ok("facebook has live post", fb.hasLivePost);
  ok("facebook daysLive from 2026-06-01 = 33", fb.daysLive === 33);
  ok("facebook label", fb.label === "Facebook Marketplace");
}
{
  const kj = rows.find((r) => r.channel === "kijiji")!;
  ok("kijiji 1 lead", kj.leads === 1);
  ok("kijiji 0 advanced", kj.advanced === 0);
  ok("kijiji suggestion = reply faster (leads, none advanced)", /reply faster/.test(kj.suggestion));
}
{
  const zu = rows.find((r) => r.channel === "zumper")!;
  ok("zumper appears despite 0 leads (has a post)", zu.leads === 0);
  ok("zumper no live post (expired)", !zu.hasLivePost);
  ok("zumper suggestion = post/repost", /repost|Post it/.test(zu.suggestion));
}
{
  const un = rows.find((r) => r.channel === "untracked")!;
  ok("untracked bucket exists", !!un);
  ok("untracked has 2 leads (null + unknown post)", un.leads === 2);
  ok("untracked label", un.label === "Direct / untracked");
  ok("untracked suggestion mentions tracked link", /tracked link/.test(un.suggestion));
}

// Sorted by leads desc: facebook (2) first among tracked; untracked (2) ties.
ok("rows sorted leads desc", rows[0].leads >= rows[rows.length - 1].leads);

// --- totals ----------------------------------------------------------------
{
  const t = analyticsTotals(rows);
  ok("total leads 5", t.leads === 5);
  ok("total advanced 2", t.advanced === 2); // facebook booked + untracked leased
  ok("channelsWithLeads = facebook+kijiji+untracked = 3", t.channelsWithLeads === 3);
}

console.log(`\ndistribution-analytics: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
