// Unit tests for the pure distribution verification model (S480). Run:
//   npx tsx scripts/test-distribution-verification.ts
import {
  interpretPublicPageProof,
  interpretOrgFeedProof,
  interpretExternalUrlProof,
  scheduleNextVerification,
  isVerificationStale,
  canMarkLive,
  isSubmittedNotLive,
  verificationResultLabel,
} from "@/lib/distribution-verification";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(c: boolean, msg: string): void {
  if (c) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}

// --- public page ------------------------------------------------------------
eq(
  interpretPublicPageProof({ isPublic: true, bookable: true, hasAddress: true, hasRent: true, hasPhoto: true }).result,
  "verified_live",
  "public page all-good => verified_live",
);
eq(
  interpretPublicPageProof({ isPublic: false, bookable: false, hasAddress: true, hasRent: true, hasPhoto: true }).result,
  "not_found",
  "not public => not_found",
);
{
  const o = interpretPublicPageProof({ isPublic: true, bookable: true, hasAddress: true, hasRent: false, hasPhoto: true });
  eq(o.result, "failed", "missing rent => failed");
  ok((o.failureReason ?? "").includes("rent"), "failure names rent");
}

// --- org feed (submitted, NEVER live) ---------------------------------------
{
  const o = interpretOrgFeedProof({ feedReachable: true, listingIncluded: true, hasRequiredFields: true });
  eq(o.result, "verified_submitted", "feed included+fields => verified_submitted");
  ok(!canMarkLive(o.result), "feed submitted is NOT markable live");
  ok(isSubmittedNotLive(o.result), "feed is submitted-not-live");
}
eq(
  interpretOrgFeedProof({ feedReachable: true, listingIncluded: false, hasRequiredFields: false }).result,
  "not_found",
  "feed reachable but not included => not_found",
);
eq(
  interpretOrgFeedProof({ feedReachable: false, listingIncluded: false, hasRequiredFields: false }).result,
  "failed",
  "feed unreachable => failed",
);

// --- external url -----------------------------------------------------------
eq(
  interpretExternalUrlProof({ reachable: true, loginGated: false, matchedListing: true }).result,
  "verified_live",
  "reachable + matched => verified_live",
);
eq(
  interpretExternalUrlProof({ reachable: false, loginGated: true, matchedListing: false }).result,
  "needs_login",
  "login gated => needs_login (not failure)",
);
eq(
  interpretExternalUrlProof({ reachable: false, loginGated: false, matchedListing: false }).result,
  "not_found",
  "unreachable => not_found",
);
eq(
  interpretExternalUrlProof({ reachable: true, loginGated: false, matchedListing: false }).result,
  "proof_unavailable",
  "reachable but unmatched => proof_unavailable",
);

// --- canMarkLive ------------------------------------------------------------
ok(canMarkLive("verified_live"), "verified_live is markable live");
ok(!canMarkLive("verified_submitted"), "submitted is not live");
ok(!canMarkLive("needs_login"), "needs_login is not live");

// --- scheduling -------------------------------------------------------------
{
  const now = "2026-07-13T00:00:00.000Z";
  eq(scheduleNextVerification("facebook", "verified_live", now), "2026-07-27T00:00:00.000Z", "facebook live +14d");
  eq(scheduleNextVerification("rentfaster", "verified_live", now), "2026-07-27T00:00:00.000Z", "rentfaster live +14d");
  eq(scheduleNextVerification("org_feed", "verified_submitted", now), "2026-07-20T00:00:00.000Z", "org_feed submitted +7d");
  eq(scheduleNextVerification("kijiji", "needs_login", now), "2026-07-14T00:00:00.000Z", "needs_login +1d");
  eq(scheduleNextVerification("facebook", "not_found", now), null, "not_found => no auto recheck");
}
{
  const now = "2026-07-30T00:00:00.000Z";
  ok(isVerificationStale("facebook", "2026-07-13T00:00:00.000Z", now), "17d old facebook is stale (>14d)");
  ok(!isVerificationStale("facebook", "2026-07-25T00:00:00.000Z", now), "5d old facebook not stale");
}
eq(verificationResultLabel("verified_live"), "Verified live", "result label");

console.log(`test-distribution-verification: ${pass}/${fail}`);
if (fail > 0) process.exit(1);
