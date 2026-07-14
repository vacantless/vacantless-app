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
  isWebUrl,
  validateListingPost,
  listingPostErrorMessage,
  reservableTrackerId,
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

// --- validation ------------------------------------------------------------
ok("isWebUrl: https ok", isWebUrl("https://www.kijiji.ca/abc"));
ok("isWebUrl: http ok", isWebUrl("http://example.com"));
ok("isWebUrl: bare domain rejected (pre-normalize)", !isWebUrl("kijiji.ca/abc"));
ok("isWebUrl: no dot in host rejected", !isWebUrl("https://localhost"));
ok("isWebUrl: spaces rejected", !isWebUrl("https://a b.com"));
ok("isWebUrl: junk rejected", !isWebUrl("not a url"));
ok("isWebUrl: null rejected", !isWebUrl(null));

ok(
  "validate: live + url ok",
  validateListingPost({ portal: "kijiji", status: "live", url: "https://k.ca/x" })
    .ok === true,
);
const liveNoUrl = validateListingPost({
  portal: "kijiji",
  status: "live",
  url: null,
});
ok("validate: live + no url fails", liveNoUrl.ok === false);
ok(
  "validate: live + no url -> live_needs_url on url field",
  liveNoUrl.ok === false &&
    liveNoUrl.field === "url" &&
    liveNoUrl.code === "live_needs_url",
);
ok(
  "validate: draft + no url ok",
  validateListingPost({ portal: "kijiji", status: "draft", url: null }).ok ===
    true,
);
ok(
  "validate: expired + no url ok",
  validateListingPost({ portal: "kijiji", status: "expired", url: null }).ok ===
    true,
);
const badUrl = validateListingPost({
  portal: "other",
  status: "draft",
  url: "ftp://nope",
});
ok("validate: any provided url must be web", badUrl.ok === false);
ok(
  "validate: bad url -> url_not_web",
  badUrl.ok === false && badUrl.code === "url_not_web",
);
ok(
  "validate: live whitespace-only url already normalized to null -> live_needs_url",
  // normalizeUrl turns "   " into null; mirror that the action passes null here.
  validateListingPost({ portal: "kijiji", status: "live", url: normalizeUrl("   ") })
    .ok === false,
);

ok(
  "errorMessage: live_needs_url mentions Live",
  listingPostErrorMessage("live_needs_url").includes("Live"),
);
ok(
  "errorMessage: url_not_web mentions web link",
  listingPostErrorMessage("url_not_web").includes("web link"),
);
ok(
  "errorMessage: unknown -> generic",
  listingPostErrorMessage("???").length > 0,
);

// --- reservableTrackerId (distribution hardening #2) ------------------------
ok(
  "reserve: no posts -> null (create)",
  reservableTrackerId([], "facebook") === null,
);
ok(
  "reserve: only removed -> null (create)",
  reservableTrackerId(
    [{ id: "r1", portal: "facebook", status: "removed", created_at: "2026-01-01" }],
    "facebook",
  ) === null,
);
ok(
  "reserve: single live -> reuse it",
  reservableTrackerId(
    [{ id: "L1", portal: "facebook", status: "live", created_at: "2026-01-01" }],
    "facebook",
  ) === "L1",
);
ok(
  "reserve: prefers live over a newer draft",
  reservableTrackerId(
    [
      { id: "L1", portal: "facebook", status: "live", created_at: "2026-01-01" },
      { id: "D2", portal: "facebook", status: "draft", created_at: "2026-06-01" },
    ],
    "facebook",
  ) === "L1",
);
ok(
  "reserve: no live -> newest non-removed row wins",
  reservableTrackerId(
    [
      { id: "D1", portal: "kijiji", status: "draft", created_at: "2026-01-01" },
      { id: "D3", portal: "kijiji", status: "draft", created_at: "2026-06-01" },
      { id: "D2", portal: "kijiji", status: "expired", created_at: "2026-03-01" },
    ],
    "kijiji",
  ) === "D3",
);
ok(
  "reserve: filters by portal",
  reservableTrackerId(
    [
      { id: "F1", portal: "facebook", status: "live", created_at: "2026-01-01" },
      { id: "V1", portal: "viewit", status: "draft", created_at: "2026-02-01" },
    ],
    "viewit",
  ) === "V1",
);
ok(
  "reserve: ignores a newer removed row",
  reservableTrackerId(
    [
      { id: "D1", portal: "viewit", status: "draft", created_at: "2026-01-01" },
      { id: "X2", portal: "viewit", status: "removed", created_at: "2026-09-01" },
    ],
    "viewit",
  ) === "D1",
);
ok(
  "errorMessage: no em dashes",
  !/[—–]/.test(
    listingPostErrorMessage("live_needs_url") +
      listingPostErrorMessage("url_not_web"),
  ),
);

// ---------------------------------------------------------------------------
console.log(`\nlisting-distribution: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
