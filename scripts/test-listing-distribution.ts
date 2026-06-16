// Unit tests for the pure listing-distribution logic.
// Run: npx tsx scripts/test-listing-distribution.ts
import {
  PORTAL_KEYS,
  PORTALS,
  isPortalKey,
  normalizePortal,
  portalLabel,
  LISTING_POST_STATUSES,
  isListingPostStatus,
  normalizeListingStatus,
  listingPostStatusLabel,
  normalizeUrl,
  normalizeText,
  normalizeDate,
  buildTrackedLink,
  sourceLabelForPost,
  countLeadsByPost,
} from "../lib/listing-distribution";

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

// --- portals ---------------------------------------------------------------
ok("PORTAL_KEYS has 7", PORTAL_KEYS.length === 7);
ok("PORTALS mirrors keys", PORTALS.length === PORTAL_KEYS.length);
ok("PORTALS carries labels", PORTALS[0].label === "Kijiji");
ok("isPortalKey: kijiji", isPortalKey("kijiji"));
ok("isPortalKey: rejects junk", !isPortalKey("craigslist"));
ok("isPortalKey: rejects non-string", !isPortalKey(7));
ok("normalizePortal: trims + accepts", normalizePortal(" facebook ") === "facebook");
ok("normalizePortal: junk -> other", normalizePortal("nope") === "other");
ok("normalizePortal: blank -> other", normalizePortal("") === "other");
ok("normalizePortal: non-string -> other", normalizePortal(null) === "other");
ok("portalLabel: rentals_ca", portalLabel("rentals_ca") === "Rentals.ca");
ok("portalLabel: facebook", portalLabel("facebook") === "Facebook Marketplace");
ok("portalLabel: junk -> Other", portalLabel("xyz") === "Other");

// --- statuses --------------------------------------------------------------
ok("LISTING_POST_STATUSES has 4", LISTING_POST_STATUSES.length === 4);
ok("isListingPostStatus: live", isListingPostStatus("live"));
ok("isListingPostStatus: rejects junk", !isListingPostStatus("paused"));
ok("normalizeListingStatus: accepts", normalizeListingStatus("expired") === "expired");
ok("normalizeListingStatus: junk -> live", normalizeListingStatus("paused") === "live");
ok("normalizeListingStatus: blank -> live", normalizeListingStatus("") === "live");
ok("listingPostStatusLabel: removed", listingPostStatusLabel("removed") === "Removed");
ok("listingPostStatusLabel: junk -> Live", listingPostStatusLabel("zzz") === "Live");

// --- url normalization -----------------------------------------------------
ok("normalizeUrl: blank -> null", normalizeUrl("") === null);
ok("normalizeUrl: non-string -> null", normalizeUrl(null) === null);
ok("normalizeUrl: keeps https", normalizeUrl("https://kijiji.ca/x") === "https://kijiji.ca/x");
ok("normalizeUrl: keeps http", normalizeUrl("http://kijiji.ca/x") === "http://kijiji.ca/x");
ok(
  "normalizeUrl: bare domain gets https",
  normalizeUrl("kijiji.ca/v-apartment/123") === "https://kijiji.ca/v-apartment/123",
);
ok("normalizeUrl: trims", normalizeUrl("  https://a.co  ") === "https://a.co");
ok("normalizeUrl: non-url text passes through", normalizeUrl("posted by hand") === "posted by hand");

// --- text + date -----------------------------------------------------------
ok("normalizeText: trims", normalizeText("  hi  ") === "hi");
ok("normalizeText: blank -> null", normalizeText("   ") === null);
ok("normalizeText: non-string -> null", normalizeText(5) === null);
ok("normalizeDate: accepts iso", normalizeDate("2026-07-01") === "2026-07-01");
ok("normalizeDate: junk -> null", normalizeDate("July 1") === null);
ok("normalizeDate: blank -> null", normalizeDate("") === null);

// --- tracked link ----------------------------------------------------------
ok(
  "buildTrackedLink: appends p on clean url",
  buildTrackedLink("https://x.co/r/abc", "post1") === "https://x.co/r/abc?p=post1",
);
ok(
  "buildTrackedLink: uses & when query exists",
  buildTrackedLink("https://x.co/r/abc?z=1", "post1") === "https://x.co/r/abc?z=1&p=post1",
);
ok(
  "buildTrackedLink: encodes the id",
  buildTrackedLink("https://x.co/r/abc", "a b") === "https://x.co/r/abc?p=a%20b",
);
ok(
  "buildTrackedLink: empty id returns base",
  buildTrackedLink("https://x.co/r/abc", "") === "https://x.co/r/abc",
);

// --- source label (must mirror the SQL CASE) -------------------------------
ok("sourceLabelForPost: kijiji", sourceLabelForPost({ portal: "kijiji" }) === "Kijiji");
ok(
  "sourceLabelForPost: facebook",
  sourceLabelForPost({ portal: "facebook" }) === "Facebook Marketplace",
);
ok(
  "sourceLabelForPost: other uses label",
  sourceLabelForPost({ portal: "other", label: "PadMapper" }) === "PadMapper",
);
ok(
  "sourceLabelForPost: other blank label -> Other portal",
  sourceLabelForPost({ portal: "other", label: "  " }) === "Other portal",
);
ok(
  "sourceLabelForPost: junk portal -> Other portal",
  sourceLabelForPost({ portal: "xyz" }) === "Other portal",
);

// --- counts ----------------------------------------------------------------
const counts = countLeadsByPost([
  { listing_post_id: "a" },
  { listing_post_id: "a" },
  { listing_post_id: "b" },
  { listing_post_id: null },
]);
ok("countLeadsByPost: a -> 2", counts.get("a") === 2);
ok("countLeadsByPost: b -> 1", counts.get("b") === 1);
ok("countLeadsByPost: ignores null", !counts.has("null"));
ok("countLeadsByPost: missing -> undefined", counts.get("c") === undefined);

// ---------------------------------------------------------------------------
console.log(`\nlisting-distribution: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
