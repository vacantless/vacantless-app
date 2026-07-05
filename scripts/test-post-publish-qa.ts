// Unit tests for the pure post-publish QA checker.
// Run: npx tsx scripts/test-post-publish-qa.ts
import {
  checkPastedAd,
  qaSummary,
  QA_SEVERITIES,
  type QaExpected,
} from "../lib/post-publish-qa";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const expected: QaExpected = {
  city: "Windsor",
  rentLabel: "$1,295/month",
  requireHydroDisclosure: true,
  requireUnfurnishedDisclosure: true,
  bookingUrl: "https://app.vacantless.com/r/abc?p=xyz",
  phone: "519-915-8865",
  email: "leads@agileonline.ca",
};

const GOOD_AD = `Bright 1-bed in Windsor, ON. $1,295/month, hydro not included, unfurnished.
Book a viewing: https://app.vacantless.com/r/abc?p=xyz
Call 519-915-8865 or email leads@agileonline.ca`;

ok("severities are 3", QA_SEVERITIES.length === 3);

// --- a good ad on a feed channel -------------------------------------------
{
  const checks = checkPastedAd({ pastedText: GOOD_AD, channelKey: "rentals_ca", expected });
  const s = qaSummary(checks);
  ok("good ad: city ok", checks.find((c) => c.key === "city")!.ok);
  ok("good ad: rent ok (comma-insensitive)", checks.find((c) => c.key === "rent")!.ok);
  ok("good ad: hydro ok", checks.find((c) => c.key === "hydro")!.ok);
  ok("good ad: furnishing ok", checks.find((c) => c.key === "furnishing")!.ok);
  ok("good ad: booking link ok", checks.find((c) => c.key === "booking_link")!.ok);
  ok("good ad: phone ok", checks.find((c) => c.key === "phone")!.ok);
  ok("good ad: email ok", checks.find((c) => c.key === "email")!.ok);
  ok("good ad: no critical failures", s.criticalFailures === 0);
  ok("good ad: no warnings", s.warnings === 0);
  ok("good ad on non-fb/kijiji: all clear", s.allClear);
}

// --- a bad ad --------------------------------------------------------------
{
  const bad = "Nice apartment for rent. Message me for details.";
  const checks = checkPastedAd({ pastedText: bad, channelKey: "rentals_ca", expected });
  const s = qaSummary(checks);
  ok("bad ad: city fails", !checks.find((c) => c.key === "city")!.ok);
  ok("bad ad: rent fails", !checks.find((c) => c.key === "rent")!.ok);
  ok("bad ad: booking link fails", !checks.find((c) => c.key === "booking_link")!.ok);
  ok("bad ad: has critical failures", s.criticalFailures >= 2);
  ok("bad ad: not all clear", !s.allClear);
}

// --- rent match is comma/format tolerant -----------------------------------
{
  const checks = checkPastedAd({
    pastedText: "Rent is 1295 per month in windsor",
    channelKey: "zumper",
    expected,
  });
  ok("rent 1295 (no comma) matches", checks.find((c) => c.key === "rent")!.ok);
  ok("city lowercase matches", checks.find((c) => c.key === "city")!.ok);
}

// --- Facebook always adds the link-risk tip --------------------------------
{
  const checks = checkPastedAd({ pastedText: GOOD_AD, channelKey: "facebook", expected });
  const fb = checks.find((c) => c.key === "fb_link_risk");
  ok("facebook adds link-risk tip", !!fb && fb.severity === "tip");
  // Tips don't block all-clear.
  const s = qaSummary(checks);
  ok("facebook good ad still all clear (tips ignored)", s.allClear);
}

// --- Kijiji adds the location tip ------------------------------------------
{
  const checks = checkPastedAd({ pastedText: GOOD_AD, channelKey: "kijiji", expected });
  ok("kijiji adds location tip", checks.some((c) => c.key === "kijiji_location"));
}

// --- disclosures can be turned off -----------------------------------------
{
  const noDisc: QaExpected = {
    ...expected,
    requireHydroDisclosure: false,
    requireUnfurnishedDisclosure: false,
  };
  const checks = checkPastedAd({ pastedText: "Windsor $1,295/month https://app.vacantless.com/r/abc?p=xyz 519-915-8865 leads@agileonline.ca", channelKey: "rentals_ca", expected: noDisc });
  ok("no hydro check when disclosure off", !checks.some((c) => c.key === "hydro"));
  ok("no furnishing check when disclosure off", !checks.some((c) => c.key === "furnishing"));
}

// --- no em dashes in details -----------------------------------------------
{
  const checks = checkPastedAd({ pastedText: GOOD_AD, channelKey: "facebook", expected });
  ok("no em dashes in QA detail copy", !/[—–]/.test(checks.map((c) => c.detail).join(" ")));
}

console.log(`\npost-publish-qa: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
