// Unit tests for the pure distribution freshness model (S543). Run:
//   npx tsx scripts/test-distribution-freshness.ts
import { readFileSync } from "node:fs";
import {
  freshnessDue,
  freshnessPointer,
  freshnessUpdateForVerification,
  isFreshnessPortalChannel,
  isFreshnessVerifiableChannel,
  portalFreshnessDecision,
  runItemHasFreshnessState,
  runItemNeedsRefresh,
} from "../lib/distribution-freshness";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++;
  } else {
    failed++;
    console.error(
      `FAIL: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
    );
  }
}

const NOW = "2026-07-20T12:00:00.000Z";

// --- due pointers ----------------------------------------------------------
eq(
  "pointer prefers explicit next_check_at",
  freshnessPointer({
    nextCheckAt: "2026-07-21T00:00:00.000Z",
    staleAfter: "2026-07-22T00:00:00.000Z",
    nextRetryAt: "2026-07-23T00:00:00.000Z",
  }),
  "2026-07-21T00:00:00.000Z",
);
eq(
  "null pointer is due",
  freshnessDue({ nowISO: NOW, staleAfter: null, nextRetryAt: null }),
  { due: true, pointer: null, reason: "no_pointer" },
);
eq(
  "past stale_after is due",
  freshnessDue({
    nowISO: NOW,
    staleAfter: "2026-07-20T11:59:59.000Z",
  }).reason,
  "due",
);
eq(
  "future stale_after is not due",
  freshnessDue({
    nowISO: NOW,
    staleAfter: "2026-07-20T12:00:01.000Z",
  }).due,
  false,
);
eq(
  "invalid pointer fails open as due",
  freshnessDue({ nowISO: NOW, staleAfter: "not-a-date" }).reason,
  "invalid_pointer",
);

// --- channel classes -------------------------------------------------------
ok("vacantless is verifiable", isFreshnessVerifiableChannel("vacantless"));
ok("org_feed is verifiable", isFreshnessVerifiableChannel("org_feed"));
ok("kijiji is not verifiable by cron", !isFreshnessVerifiableChannel("kijiji"));
ok("facebook is portal", isFreshnessPortalChannel("facebook"));
ok("org_feed is not portal", !isFreshnessPortalChannel("org_feed"));

// --- verifier result advancement ------------------------------------------
eq(
  "public page success advances 14 days",
  freshnessUpdateForVerification({
    channel: "vacantless",
    result: "verified_live",
    nowISO: NOW,
  }),
  {
    runItemResult: "verified_live",
    staleAfter: "2026-08-03T12:00:00.000Z",
    nextRetryAt: "2026-08-03T12:00:00.000Z",
    fresh: true,
  },
);
eq(
  "feed success stays submitted and advances 7 days",
  freshnessUpdateForVerification({
    channel: "org_feed",
    result: "verified_submitted",
    nowISO: NOW,
  }),
  {
    runItemResult: "verified_submitted",
    staleAfter: "2026-07-27T12:00:00.000Z",
    nextRetryAt: "2026-07-27T12:00:00.000Z",
    fresh: true,
  },
);
eq(
  "failed recheck becomes stale marker with short retry",
  freshnessUpdateForVerification({
    channel: "vacantless",
    result: "not_found",
    nowISO: NOW,
  }),
  {
    runItemResult: "stale",
    staleAfter: null,
    nextRetryAt: "2026-07-21T12:00:00.000Z",
    fresh: false,
  },
);

// --- portal flagging from our own tracker state ----------------------------
eq(
  "expired tracker flags refresh",
  portalFreshnessDecision({
    channel: "facebook",
    listingPostStatus: "expired",
    listingPostUrl: "https://facebook.com/marketplace/item/1",
    listingPostPostedOn: "2026-07-01",
    nowISO: NOW,
  }).reason,
  "tracker_expired",
);
eq(
  "due pointer flags portal refresh",
  portalFreshnessDecision({
    channel: "kijiji",
    listingPostStatus: "live",
    listingPostUrl: "https://www.kijiji.ca/v-apartments-condos/windsor/123",
    listingPostPostedOn: "2026-07-19",
    staleAfter: "2026-07-20T11:00:00.000Z",
    nowISO: NOW,
  }).reason,
  "pointer_due",
);
eq(
  "old posted_on flags portal refresh without fetching portal",
  portalFreshnessDecision({
    channel: "kijiji",
    listingPostStatus: "live",
    listingPostUrl: "https://www.kijiji.ca/v-apartments-condos/windsor/123",
    listingPostPostedOn: "2026-07-01",
    staleAfter: null,
    nextRetryAt: null,
    nowISO: NOW,
  }).reason,
  "posted_on_stale",
);
eq(
  "fresh portal with no pointer is not flagged",
  portalFreshnessDecision({
    channel: "kijiji",
    listingPostStatus: "live",
    listingPostUrl: "https://www.kijiji.ca/v-apartments-condos/windsor/123",
    listingPostPostedOn: "2026-07-19",
    staleAfter: null,
    nextRetryAt: null,
    nowISO: NOW,
  }).shouldFlag,
  false,
);
eq(
  "live portal without URL leaves problem state to existing guard",
  portalFreshnessDecision({
    channel: "facebook",
    listingPostStatus: "live",
    listingPostUrl: null,
    listingPostPostedOn: "2026-07-01",
    nowISO: NOW,
  }).reason,
  "missing_live_url",
);

// --- UI driver --------------------------------------------------------------
ok(
  "stale status drives needs_refresh",
  runItemNeedsRefresh({
    verificationStatus: "stale",
    staleAfter: null,
    nowISO: NOW,
  }),
);
ok(
  "elapsed stale_after drives needs_refresh",
  runItemNeedsRefresh({
    verificationStatus: "verified_live",
    staleAfter: "2026-07-20T11:00:00.000Z",
    nowISO: NOW,
  }),
);
ok(
  "future stale_after clears needs_refresh",
  !runItemNeedsRefresh({
    verificationStatus: "verified_live",
    staleAfter: "2026-07-21T12:00:00.000Z",
    nowISO: NOW,
  }),
);
ok(
  "verified status means item freshness is authoritative",
  runItemHasFreshnessState({
    verificationStatus: "verified_live",
    staleAfter: null,
  }),
);
ok(
  "missing status and pointer falls back to tracker state",
  !runItemHasFreshnessState({
    verificationStatus: null,
    staleAfter: null,
  }),
);

// --- source checks ---------------------------------------------------------
const routeSource = readFileSync(
  "app/api/cron/distribution-freshness/route.ts",
  "utf8",
);
ok(
  "route uses CRON_SECRET auth",
  routeSource.includes("process.env.CRON_SECRET"),
);
ok(
  "route dark-gated by DISTRIBUTION_FRESHNESS_ENABLED",
  routeSource.includes("DISTRIBUTION_FRESHNESS_ENABLED") &&
    routeSource.includes("envFlagEnabled"),
);
ok(
  "route does not fetch external portals",
  !/fetch\s*\(/.test(routeSource) &&
    !routeSource.includes("kijiji.ca") &&
    !routeSource.includes("facebook.com"),
);
ok(
  "route records stale instead of flipping publish_status away from live",
  routeSource.includes('runItemResult: "stale"') ||
    routeSource.includes("freshnessUpdateForVerification"),
);

const workflow = readFileSync(".github/workflows/reminders.yml", "utf8");
ok(
  "github workflow pings distribution-freshness",
  workflow.includes("/api/cron/distribution-freshness"),
);
const vercel = readFileSync("vercel.json", "utf8");
ok(
  "vercel cron registers distribution-freshness",
  vercel.includes("/api/cron/distribution-freshness"),
);

console.log(`distribution-freshness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
