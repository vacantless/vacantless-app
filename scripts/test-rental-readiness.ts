// Unit tests for the pure per-rental readiness signals.
// Run: npx tsx scripts/test-rental-readiness.ts
import {
  rentalRowReadiness,
  type RentalReadinessInput,
  type ReadinessSignal,
} from "../lib/rental-readiness";

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

function sig(input: RentalReadinessInput, key: ReadinessSignal["key"]) {
  return rentalRowReadiness(input).find((s) => s.key === key)!;
}

// A fully-ready Live rental: link live, photos, viewings, in feed.
const complete: RentalReadinessInput = {
  status: "available",
  rentCents: 185000,
  beds: 2,
  baths: 1,
  address: "123 Main St",
  description: "Bright two-bedroom with in-suite laundry.",
  photoCount: 4,
  availabilityWindowCount: 3,
};

// --- shape ------------------------------------------------------------------
{
  const r = rentalRowReadiness(complete);
  ok("returns 4 signals", r.length === 4);
  ok(
    "in order link/photos/viewings/feed",
    r.map((s) => s.key).join(",") === "link,photos,viewings,feed",
  );
  ok("every signal has a hint", r.every((s) => s.hint.trim().length > 0));
  ok("every signal has a detail", r.every((s) => s.detail.trim().length > 0));
}

// --- happy path -------------------------------------------------------------
{
  const r = rentalRowReadiness(complete);
  ok("complete: all ok", r.every((s) => s.ok));
  ok("complete: all green tone", r.every((s) => s.tone === "ok"));
  ok("complete: link detail live", sig(complete, "link").detail === "live");
  ok("complete: photos detail count", sig(complete, "photos").detail === "4");
  ok("complete: feed in feed", sig(complete, "feed").detail === "in feed");
}

// --- link signal across statuses --------------------------------------------
{
  ok("available link ok", sig(complete, "link").ok === true);

  const leased = { ...complete, status: "leased" };
  ok("leased link not ok", sig(leased, "link").ok === false);
  ok("leased link muted", sig(leased, "link").tone === "muted");
  ok("leased link detail", sig(leased, "link").detail === "leased");

  const paused = { ...complete, status: "paused" };
  ok("paused link muted", sig(paused, "link").tone === "muted");
  ok("paused link detail", sig(paused, "link").detail === "paused");

  const draft = { ...complete, status: "draft" };
  ok("draft link muted", sig(draft, "link").tone === "muted");
  ok("draft link not live", sig(draft, "link").detail === "not live");

  const off = { ...complete, status: "off_market" };
  ok("off_market link not live", sig(off, "link").detail === "not live");
}

// --- photos signal ----------------------------------------------------------
{
  const noPhotos = { ...complete, photoCount: 0 };
  ok("no photos warn", sig(noPhotos, "photos").tone === "warn");
  ok("no photos not ok", sig(noPhotos, "photos").ok === false);
  ok("no photos detail none", sig(noPhotos, "photos").detail === "none");

  const one = { ...complete, photoCount: 1 };
  ok("one photo ok", sig(one, "photos").ok === true);
  ok("one photo detail 1", sig(one, "photos").detail === "1");
  ok("one photo singular hint", sig(one, "photos").hint.includes("1 photo added"));
}

// --- viewings signal (org-wide) ---------------------------------------------
{
  const noWindows = { ...complete, availabilityWindowCount: 0 };
  ok("no viewings warn", sig(noWindows, "viewings").tone === "warn");
  ok("no viewings not ok", sig(noWindows, "viewings").ok === false);

  ok("viewings ok when windows set", sig(complete, "viewings").ok === true);
}

// --- feed signal ------------------------------------------------------------
{
  // Live but missing a photo -> feed blocked (warn), reason names the photo.
  const noPhoto = { ...complete, photoCount: 0 };
  const f1 = sig(noPhoto, "feed");
  ok("feed blocked when no photo", f1.ok === false && f1.tone === "warn");
  ok("feed blocked detail", f1.detail === "blocked");
  ok("feed hint names photo", f1.hint.includes("a photo"));

  // Live but missing rent + description -> both named.
  const bare = { ...complete, rentCents: null, description: null };
  const f2 = sig(bare, "feed");
  ok("feed blocked when rent+desc missing", f2.ok === false);
  ok("feed hint names rent", f2.hint.includes("rent"));
  ok("feed hint names description", f2.hint.includes("a description"));

  // Not live -> feed is a muted "not live", not an error.
  const draft = { ...complete, status: "draft" };
  const f3 = sig(draft, "feed");
  ok("draft feed muted", f3.tone === "muted");
  ok("draft feed not live", f3.detail === "not live");

  const leased = { ...complete, status: "leased" };
  ok("leased feed muted", sig(leased, "feed").tone === "muted");
}

// --- empty draft: nothing ready ---------------------------------------------
{
  const empty: RentalReadinessInput = {
    status: "draft",
    rentCents: null,
    beds: null,
    baths: null,
    address: null,
    description: null,
    photoCount: 0,
    availabilityWindowCount: 0,
  };
  const r = rentalRowReadiness(empty);
  ok("empty: nothing ok", r.every((s) => !s.ok));
  ok(
    "empty: link+feed muted, photos+viewings warn",
    sig(empty, "link").tone === "muted" &&
      sig(empty, "feed").tone === "muted" &&
      sig(empty, "photos").tone === "warn" &&
      sig(empty, "viewings").tone === "warn",
  );
}

console.log(`\nrental-readiness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
