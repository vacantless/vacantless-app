// Pure tests for the listing-post live check (S693): target derivation,
// end-url-first classification against the signals measured 2026-09-07, and
// the single write the check is allowed to make.
// Run: npx tsx scripts/test-listing-post-live-check.ts
import {
  LIVE_CHECK_PORTALS,
  LIVE_CHECK_WRITABLE_VERDICTS,
  classifyListingPostLiveCheck,
  isLiveCheckPortal,
  listingPostLiveCheckTarget,
  liveCheckNoteLine,
  liveCheckRowPatch,
  type LiveCheckFacts,
} from "../lib/listing-post-live-check";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, actual === expected);
  if (actual !== expected) {
    console.error(`    expected: ${String(expected)}`);
    console.error(`    actual:   ${String(actual)}`);
  }
}

const NOW = "2026-09-07T22:40:12.000Z";

// --- fixtures (measured 2026-09-07) ------------------------------------------

const KIJIJI_MANNING =
  "https://www.kijiji.ca/v-apartments-condos/city-of-toronto/bright-1-bed-den-little-italy-utilities-included-dec-1/1743093990";
const KIJIJI_MANNING_REMOVED_END =
  "https://www.kijiji.ca/b-apartments-condos/city-of-toronto/c37l1700273?radius=50.0&ll=43.65951%2C-79.41452&adRemoved=1743093990";
const KIJIJI_U33 =
  "https://www.kijiji.ca/v-apartments-condos/windsor-area-on/3rd-floor-top-1-bedroom-renovated-833-pillette-rd-windsor/1742946283";

const ZUMPER_MANAGE = "https://www.zumper.com/manage/properties/listing/65274796";
const ZUMPER_PUBLIC = "https://www.zumper.com/listings/65274796";
const ZUMPER_LIVE_END =
  "https://www.zumper.com/listings/65274796/1-bedroom-south-annex-toronto-on";
const ZUMPER_REMOVED_END =
  "https://www.zumper.com/listings/64945958/1-bedroom-pillette-road-village-windsor-on";
const ZUMPER_LIVE_BODY =
  "<html><title>506 Manning Avenue #Lower, Toronto, ON M6G 2V7 1 Bedroom Apartment for $1,750/month - Zumper</title><body>Request tour Check availability Apartment for rent UPDATED 1 DAY AGO MONTHLY RENT $1,750</body></html>";
const ZUMPER_REMOVED_BODY =
  "<html><title>833 Pillette Road, Windsor, ON N8Y 3B4 1 Bedroom Apartment for $1,195/month - Zumper</title><body>Notify me Apartment for rent MONTHLY RENT - Notify me Alert me when this rental is available. Highlights</body></html>";
const ZUMPER_CHALLENGE_BODY =
  "<html><head><title>Client Challenge</title></head><body><script>window.__cf_chl_opt=1</script></body></html>";

const RCA_LIVE = "https://rentals.ca/windsor-on/833-pillette-road-7";
const RCA_LIVE_ID = "https://rentals.ca/windsor-on/833-pillette-road-id1540338";
const RCA_REMOVED = "https://rentals.ca/windsor-on/833-pillette-road-6";
const RCA_REMOVED_END = "https://rentals.ca/windsor-on";
const RCA_LIVE_BODY =
  '<html><head><script type="application/ld+json">{"@type":"ApartmentComplex","url":"https://rentals.ca/windsor-on/833-pillette-road-7"}</script></head><body>$1250 Apartment Get In Touch Contact Property Request a Tour</body></html>';
const RCA_MISSED_BODY =
  "<html><body>Missed Shot! Oops! We couldn't find the page you were looking for. Search</body></html>";
const RCA_CF_BODY =
  '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">__cf_chl_rt_tk</div></body></html>';

function facts(over: Partial<LiveCheckFacts> & Pick<LiveCheckFacts, "portal" | "requestedUrl">): LiveCheckFacts {
  return {
    endUrl: over.requestedUrl,
    httpStatus: 200,
    bodyText: "",
    fetchError: null,
    ...over,
  };
}

// --- portals ----------------------------------------------------------------

console.log("portals");
eq("three checkable portals", LIVE_CHECK_PORTALS.length, 3);
ok("kijiji checkable", isLiveCheckPortal("kijiji"));
ok("zumper checkable", isLiveCheckPortal("zumper"));
ok("rentals_ca checkable", isLiveCheckPortal("rentals_ca"));
ok("facebook not checkable (login wall)", !isLiveCheckPortal("facebook"));
ok("instagram not checkable", !isLiveCheckPortal("instagram"));
ok("facebook_feed not checkable", !isLiveCheckPortal("facebook_feed"));
ok("null not checkable", !isLiveCheckPortal(null));
eq("only removed is writable", LIVE_CHECK_WRITABLE_VERDICTS.join(","), "removed");

// --- targets ----------------------------------------------------------------

console.log("targets");
{
  const t = listingPostLiveCheckTarget("kijiji", KIJIJI_MANNING);
  eq("kijiji target url is the ad url", t?.url, KIJIJI_MANNING);
  eq("kijiji ad id", t?.externalId, "1743093990");
  eq("kijiji target strips a query", listingPostLiveCheckTarget("kijiji", `${KIJIJI_U33}?utm=x`)?.url, KIJIJI_U33);
  eq("kijiji search url is not a target", listingPostLiveCheckTarget("kijiji", "https://www.kijiji.ca/b-apartments-condos/windsor-area-on/c37l1700220"), null);
  eq("kijiji manage url is not a target", listingPostLiveCheckTarget("kijiji", "https://www.kijiji.ca/m-my-ads/active/1"), null);
}
{
  const t = listingPostLiveCheckTarget("zumper", ZUMPER_MANAGE);
  eq("zumper manage url derives the public page", t?.url, ZUMPER_PUBLIC);
  eq("zumper id from manage url", t?.externalId, "65274796");
  eq("zumper public slug url derives the bare public page", listingPostLiveCheckTarget("zumper", ZUMPER_LIVE_END)?.url, ZUMPER_PUBLIC);
  eq("zumper wizard url is not a target", listingPostLiveCheckTarget("zumper", "https://www.zumper.com/manage/properties/64945958/edit"), null);
}
{
  const t = listingPostLiveCheckTarget("rentals_ca", RCA_LIVE_ID);
  eq("rentals_ca target keeps the public url", t?.url, RCA_LIVE_ID);
  eq("rentals_ca id from -id suffix", t?.externalId, "1540338");
  eq("rentals_ca slug without id has null id", listingPostLiveCheckTarget("rentals_ca", RCA_LIVE)?.externalId, null);
  eq("rentals_ca manage checkout url is not a target", listingPostLiveCheckTarget("rentals_ca", "https://rentals.ca/manage/listings/1540374/checkout"), null);
  eq("rentals_ca city page is not a target", listingPostLiveCheckTarget("rentals_ca", "https://rentals.ca/windsor-on"), null);
}
eq("facebook has no target", listingPostLiveCheckTarget("facebook", "https://www.facebook.com/marketplace/item/1218512567595763/"), null);
eq("blank url has no target", listingPostLiveCheckTarget("kijiji", "  "), null);
eq("garbage url has no target", listingPostLiveCheckTarget("kijiji", "not a url"), null);
eq("wrong host has no target", listingPostLiveCheckTarget("kijiji", "https://example.com/v-apartments-condos/x/123456789"), null);

// --- kijiji -----------------------------------------------------------------

console.log("kijiji");
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_MANNING, endUrl: KIJIJI_MANNING_REMOVED_END, bodyText: "<title>13589 Apartments, Condos & Houses For Rent</title>" }),
    { externalId: "1743093990" },
  );
  eq("adRemoved redirect for the same id = removed", o.verdict, "removed");
  eq("kijiji removed reason", o.reason, "kijiji_ad_removed_redirect");
  ok("kijiji removed evidence names the ad id", (o.evidence ?? "").includes("1743093990"));
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_MANNING, endUrl: KIJIJI_MANNING_REMOVED_END }),
    { externalId: "1742946283" },
  );
  eq("adRemoved for ANOTHER id = unknown", o.verdict, "unknown");
  eq("kijiji other-id reason", o.reason, "kijiji_ad_removed_other_id");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, bodyText: "<title>3rd Floor (Top) 1 Bedroom</title> lots of html captcha-free" }),
    { externalId: "1742946283" },
  );
  eq("200 on the ad url, no redirect = live", o.verdict, "live");
  eq("kijiji live reason", o.reason, "kijiji_ad_page_200");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, endUrl: "https://www.kijiji.ca/b-apartments-condos/windsor-area-on/c37l1700220" }),
    { externalId: "1742946283" },
  );
  eq("search redirect WITHOUT adRemoved = unknown", o.verdict, "unknown");
  eq("kijiji search-without-signal reason", o.reason, "kijiji_search_redirect_without_ad_removed");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, endUrl: "https://www.kijiji.ca/t-login.html?targetUrl=x" }),
    { externalId: "1742946283" },
  );
  eq("login redirect = needs_login", o.verdict, "needs_login");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, httpStatus: 403, bodyText: RCA_CF_BODY }),
    { externalId: "1742946283" },
  );
  eq("kijiji behind cloudflare = challenge", o.verdict, "challenge");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, httpStatus: 404 }),
    { externalId: "1742946283" },
  );
  eq("kijiji 404 on the ad url = unknown (unmeasured)", o.verdict, "unknown");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, endUrl: null, httpStatus: null, bodyText: null, fetchError: "TimeoutError: The operation was aborted due to timeout" }),
    { externalId: "1742946283" },
  );
  eq("fetch error = unreachable", o.verdict, "unreachable");
  eq("unreachable reason", o.reason, "fetch_error");
}

// --- zumper -----------------------------------------------------------------

console.log("zumper");
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, endUrl: ZUMPER_LIVE_END, bodyText: ZUMPER_LIVE_BODY }),
    { externalId: "65274796" },
  );
  eq("inquiry CTA on the listing page = live", o.verdict, "live");
  eq("zumper live reason", o.reason, "zumper_inquiry_cta_present");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: "https://www.zumper.com/listings/64945958", endUrl: ZUMPER_REMOVED_END, bodyText: ZUMPER_REMOVED_BODY }),
    { externalId: "64945958" },
  );
  eq("Alert me when this rental is available = removed", o.verdict, "removed");
  eq("zumper removed reason", o.reason, "zumper_notify_me_page");
  ok("zumper removed evidence names the listing", (o.evidence ?? "").includes("64945958"));
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: "https://www.zumper.com/listings/64945958", endUrl: ZUMPER_REMOVED_END, bodyText: "<body>Notify me Check availability MONTHLY RENT $1,195</body>" }),
    { externalId: "64945958" },
  );
  eq("bare Notify me with a live CTA = live (label alone is not the signal)", o.verdict, "live");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, endUrl: ZUMPER_LIVE_END, bodyText: `${ZUMPER_LIVE_BODY}${ZUMPER_REMOVED_BODY}` }),
    { externalId: "65274796" },
  );
  eq("both markers in one document = unknown", o.verdict, "unknown");
  eq("zumper conflicting reason", o.reason, "zumper_conflicting_markers");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, bodyText: ZUMPER_CHALLENGE_BODY }),
    { externalId: "65274796" },
  );
  eq("Client Challenge title = challenge even on HTTP 200", o.verdict, "challenge");
  eq("zumper challenge reason", o.reason, "bot_wall_page");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, endUrl: "https://www.zumper.com/login?next=/listings/65274796" }),
    { externalId: "65274796" },
  );
  eq("zumper login redirect = needs_login", o.verdict, "needs_login");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, httpStatus: 404, bodyText: "<body>Not found</body>" }),
    { externalId: "65274796" },
  );
  eq("zumper 404 = unknown (unmeasured), never removed", o.verdict, "unknown");
  eq("zumper 404 reason", o.reason, "zumper_http_404_unmeasured");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, endUrl: "https://www.zumper.com/apartments-for-rent/toronto-on", bodyText: ZUMPER_LIVE_BODY }),
    { externalId: "65274796" },
  );
  eq("zumper redirect off the listing = unknown", o.verdict, "unknown");
  eq("zumper off-listing reason", o.reason, "zumper_end_url_not_listing");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, endUrl: ZUMPER_LIVE_END, bodyText: "<body>nothing recognisable</body>" }),
    { externalId: "65274796" },
  );
  eq("zumper listing page with no marker = unknown", o.verdict, "unknown");
}

// --- rentals.ca -------------------------------------------------------------

console.log("rentals_ca");
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_LIVE, bodyText: RCA_LIVE_BODY }),
    { externalId: null },
  );
  eq("200 on the listing path with the listing page = live", o.verdict, "live");
  eq("rentals_ca live reason", o.reason, "rentals_ca_listing_page_200");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_REMOVED, endUrl: RCA_REMOVED_END, bodyText: "<body>Windsor Apartments, Condos and Houses for Rent 825 Rentals found</body>" }),
    { externalId: null },
  );
  eq("redirect to the bare city search page = removed", o.verdict, "removed");
  eq("rentals_ca removed reason", o.reason, "rentals_ca_city_search_redirect");
  ok("rentals_ca removed evidence names the city page", (o.evidence ?? "").includes("windsor-on"));
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_REMOVED, endUrl: "https://rentals.ca/toronto" }),
    { externalId: null },
  );
  eq("redirect to a DIFFERENT city page = unknown", o.verdict, "unknown");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: "https://rentals.ca/toronto/506-manning-avenue-id1540347", bodyText: RCA_MISSED_BODY }),
    { externalId: "1540347" },
  );
  eq("Missed Shot page on the same path = unknown, not removed", o.verdict, "unknown");
  eq("rentals_ca not-found reason", o.reason, "rentals_ca_not_found_page");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_LIVE_ID, httpStatus: 403, bodyText: RCA_CF_BODY }),
    { externalId: "1540338" },
  );
  eq("Cloudflare 403 = challenge", o.verdict, "challenge");
  eq("rentals_ca challenge reason", o.reason, "bot_wall_page");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_LIVE_ID, httpStatus: 403, bodyText: "" }),
    { externalId: "1540338" },
  );
  eq("bare 403 = challenge", o.verdict, "challenge");
  eq("bare 403 reason", o.reason, "http_403");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_LIVE_ID, endUrl: "https://rentals.ca/login?redirect-after-login=/windsor-on/833-pillette-road-id1540338" }),
    { externalId: "1540338" },
  );
  eq("rentals_ca login bounce = needs_login", o.verdict, "needs_login");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_LIVE, bodyText: "<body>no markers at all</body>" }),
    { externalId: null },
  );
  eq("rentals_ca same path, no marker = unknown", o.verdict, "unknown");
}

// --- unsupported ------------------------------------------------------------

console.log("unsupported");
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "facebook", requestedUrl: "https://www.facebook.com/marketplace/item/1218512567595763/", bodyText: ZUMPER_REMOVED_BODY }),
    null,
  );
  eq("facebook = unsupported regardless of body", o.verdict, "unsupported");
}

// --- the write --------------------------------------------------------------

console.log("row patch");
const removed = classifyListingPostLiveCheck(
  facts({ portal: "kijiji", requestedUrl: KIJIJI_MANNING, endUrl: KIJIJI_MANNING_REMOVED_END }),
  { externalId: "1743093990" },
);
const live = classifyListingPostLiveCheck(
  facts({ portal: "kijiji", requestedUrl: KIJIJI_U33 }),
  { externalId: "1742946283" },
);
const challenge = classifyListingPostLiveCheck(
  facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, bodyText: ZUMPER_CHALLENGE_BODY }),
  { externalId: "65274796" },
);
{
  const p = liveCheckRowPatch({ status: "live", notes: "S685: reserved before posting." }, removed, NOW);
  eq("live + removed = status removed", p?.status, "removed");
  ok("note keeps the prior text", (p?.notes ?? "").startsWith("S685: reserved before posting.\n"));
  ok("note carries the dated live-check line", (p?.notes ?? "").includes("live-check 2026-09-07 22:40Z: REMOVED (kijiji_ad_removed_redirect)"));
  ok("note says nothing was re-posted", (p?.notes ?? "").includes("nothing was re-posted"));
}
{
  const p = liveCheckRowPatch({ status: "live", notes: null }, removed, NOW);
  eq("null notes = just the line", p?.notes, liveCheckNoteLine(removed, NOW));
  ok("note line has no leading newline", !(p?.notes ?? "\n").startsWith("\n"));
}
{
  const p = liveCheckRowPatch({ status: "live", notes: "prior   \n\n" }, removed, NOW);
  ok("trailing whitespace on the prior note is trimmed before the newline", p?.notes === `prior\n${liveCheckNoteLine(removed, NOW)}`);
}
eq("live verdict writes nothing", liveCheckRowPatch({ status: "live", notes: null }, live, NOW), null);
eq("challenge verdict writes nothing", liveCheckRowPatch({ status: "live", notes: null }, challenge, NOW), null);
eq("a draft row is never touched, even on removed", liveCheckRowPatch({ status: "draft", notes: null }, removed, NOW), null);
eq("an already-removed row is never touched", liveCheckRowPatch({ status: "removed", notes: null }, removed, NOW), null);
eq("an expired row is never touched", liveCheckRowPatch({ status: "expired", notes: null }, removed, NOW), null);
ok("note stamp falls back to the raw value on a non-ISO input", liveCheckNoteLine(removed, "sometime").startsWith("live-check sometime: REMOVED"));


// --- reviewer additions (S693) ----------------------------------------------

console.log("edges");
eq("scheme-less kijiji url still targets", listingPostLiveCheckTarget("kijiji", "kijiji.ca/v-apartments-condos/windsor-area-on/x/1742946283")?.externalId, "1742946283");
eq("mobile host m.kijiji.ca targets", listingPostLiveCheckTarget("kijiji", "https://m.kijiji.ca/v-apartments-condos/windsor-area-on/x/1742946283")?.url, "https://m.kijiji.ca/v-apartments-condos/windsor-area-on/x/1742946283");
eq("uppercase scheme + host targets", listingPostLiveCheckTarget("kijiji", "HTTPS://WWW.KIJIJI.CA/v-apartments-condos/windsor-area-on/x/1742946283")?.externalId, "1742946283");
eq("kijiji trailing slash keeps the id", listingPostLiveCheckTarget("kijiji", `${KIJIJI_U33}/`)?.externalId, "1742946283");
eq("www.rentals.ca targets", listingPostLiveCheckTarget("rentals_ca", "https://www.rentals.ca/windsor-on/833-pillette-road-id1540338")?.externalId, "1540338");
eq("bare zumper.com host targets", listingPostLiveCheckTarget("zumper", "https://zumper.com/listings/65274796")?.url, ZUMPER_PUBLIC);
eq("lookalike host kijiji.ca.evil.com is refused", listingPostLiveCheckTarget("kijiji", "https://kijiji.ca.evil.com/v-apartments-condos/x/y/1742946283"), null);

for (const portal of ["kijiji", "zumper", "rentals_ca"] as const) {
  const o = classifyListingPostLiveCheck(
    facts({ portal, requestedUrl: portal === "kijiji" ? KIJIJI_U33 : portal === "zumper" ? ZUMPER_PUBLIC : RCA_LIVE, endUrl: null }),
    { externalId: "1" },
  );
  eq(`${portal}: no end url without a fetch error = unknown`, o.verdict, "unknown");
  eq(`${portal}: no end url reason`, o.reason, "no_end_url");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_U33, endUrl: "https://www.kijiji.ca/v-apartments-condos/windsor-area-on/renamed-slug/1742946283", bodyText: "<title>ad</title>" }),
    { externalId: "1742946283" },
  );
  eq("kijiji slug-canonicalised redirect that keeps the ad id = live", o.verdict, "live");
  ok("kijiji redirected-live evidence names the end url", (o.evidence ?? "").includes("renamed-slug"));
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "kijiji", requestedUrl: KIJIJI_MANNING, endUrl: KIJIJI_MANNING_REMOVED_END, httpStatus: 500 }),
    { externalId: "1743093990" },
  );
  eq("adRemoved on a non-200 landing = unknown, not removed", o.verdict, "unknown");
  eq("kijiji non-200 adRemoved reason", o.reason, "kijiji_ad_removed_http_500");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "rentals_ca", requestedUrl: RCA_REMOVED, endUrl: RCA_REMOVED_END, httpStatus: 502 }),
    { externalId: null },
  );
  eq("rentals_ca city redirect on a non-200 landing = unknown, not removed", o.verdict, "unknown");
  eq("rentals_ca non-200 redirect reason", o.reason, "rentals_ca_city_redirect_http_502");
}
for (const code of [429, 503] as const) {
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, httpStatus: code, bodyText: "" }),
    { externalId: "65274796" },
  );
  eq(`bare ${code} = challenge`, o.verdict, "challenge");
  eq(`bare ${code} reason`, o.reason, `http_${code}`);
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, endUrl: "https://www.zumper.com/manage/properties/listing/65274796" }),
    { externalId: "65274796" },
  );
  eq("zumper bounce to /manage = needs_login", o.verdict, "needs_login");
}
{
  const o = classifyListingPostLiveCheck(
    facts({ portal: "zumper", requestedUrl: ZUMPER_PUBLIC, httpStatus: 410, bodyText: "" }),
    { externalId: "65274796" },
  );
  eq("zumper 410 = unknown (unmeasured)", o.verdict, "unknown");
  eq("zumper 410 reason", o.reason, "zumper_http_410_unmeasured");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
