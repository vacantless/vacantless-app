// Unit tests for the pure listing-copy logic. Run: npx tsx scripts/test-listing-copy.ts
import {
  COPY_PORTAL_KEYS,
  COPY_PORTALS,
  isCopyPortalKey,
  normalizeCopyPortal,
  copyPortalLabel,
  formatRent,
  bedsBathsSummary,
  truncateTitle,
  buildHeadline,
  buildListingCopy,
  buildAllListingCopy,
  stripEmDashes,
  extractLeadDescriptors,
  bedroomPhrase,
  shortenAddressForTitle,
  type ListingCopyInput,
} from "../lib/listing-copy";

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

const NOW = new Date("2026-06-15T12:00:00Z");

// --- portal keys -----------------------------------------------------------
ok("COPY_PORTAL_KEYS has 7", COPY_PORTAL_KEYS.length === 7);
ok("COPY_PORTALS mirrors keys", COPY_PORTALS.length === COPY_PORTAL_KEYS.length);
ok("isCopyPortalKey: kijiji", isCopyPortalKey("kijiji"));
ok("isCopyPortalKey: rejects junk", !isCopyPortalKey("craigslist"));
ok("isCopyPortalKey: rejects non-string", !isCopyPortalKey(7));
ok("normalizeCopyPortal: trims + accepts", normalizeCopyPortal(" facebook ") === "facebook");
ok("normalizeCopyPortal: blank -> generic", normalizeCopyPortal("") === "generic");
ok("normalizeCopyPortal: junk -> generic", normalizeCopyPortal("nope") === "generic");
ok("copyPortalLabel: kijiji", copyPortalLabel("kijiji") === "Kijiji");
ok("copyPortalLabel: rentfaster", copyPortalLabel("rentfaster") === "RentFaster.ca");
ok("copyPortalLabel: zumper names PadMapper", copyPortalLabel("zumper") === "Zumper + PadMapper");
ok("copyPortalLabel: junk -> Master copy", copyPortalLabel("x") === "Master copy");

// --- formatRent ------------------------------------------------------------
ok("formatRent: whole dollars no cents", formatRent(185000) === "$1,850/month");
ok("formatRent: keeps odd cents", formatRent(185050) === "$1,850.50/month");
ok("formatRent: null -> null", formatRent(null) === null);
ok("formatRent: zero -> null", formatRent(0) === null);
ok("formatRent: negative -> null", formatRent(-5) === null);
ok("formatRent: NaN -> null", formatRent(Number.NaN) === null);

// --- bedsBathsSummary ------------------------------------------------------
ok("bb: 2 bed 1 bath", bedsBathsSummary(2, 1) === "2 bed, 1 bath");
ok("bb: studio", bedsBathsSummary(0, 1) === "Studio, 1 bath");
ok("bb: beds only", bedsBathsSummary(3, null) === "3 bed");
ok("bb: baths only", bedsBathsSummary(null, 2) === "2 bath");
ok("bb: 1.5 bath", bedsBathsSummary(2, 1.5) === "2 bed, 1.5 bath");
ok("bb: none -> null", bedsBathsSummary(null, null) === null);

// --- truncateTitle ---------------------------------------------------------
ok("truncate: short passthrough", truncateTitle("Nice 2 bed", 64) === "Nice 2 bed");
ok("truncate: collapses whitespace", truncateTitle("a   b", 64) === "a b");
ok(
  "truncate: word boundary <= max",
  truncateTitle("one two three four five six seven", 15).length <= 15,
);
ok(
  "truncate: no trailing punctuation",
  !/[\s,.;:-]$/.test(truncateTitle("one two three, four five", 14)),
);

// --- extractLeadDescriptors ------------------------------------------------
ok("descriptors: empty -> []", extractLeadDescriptors("").length === 0);
ok("descriptors: null -> []", extractLeadDescriptors(null).length === 0);
ok(
  "descriptors: pulls bright + corner in priority order",
  JSON.stringify(extractLeadDescriptors("Corner unit, very bright and clean")) ===
    JSON.stringify(["Bright", "Corner"]),
);
ok(
  "descriptors: caps at 2 by default",
  extractLeadDescriptors("bright sunny spacious modern corner").length === 2,
);
ok(
  "descriptors: matches hyphen + space variants (main-floor / open concept)",
  JSON.stringify(extractLeadDescriptors("Bright main floor open-concept")) ===
    JSON.stringify(["Bright", "Open-Concept"]),
);
ok(
  "descriptors: 'renovated' variants collapse to one label",
  JSON.stringify(extractLeadDescriptors("newly renovated and renovated again")) ===
    JSON.stringify(["Renovated"]),
);
ok(
  "descriptors: no false invention from plain text",
  extractLeadDescriptors("A place to live near the store").length === 0,
);

// --- bedroomPhrase ---------------------------------------------------------
ok("bedroomPhrase: studio", bedroomPhrase(0) === "Studio");
ok("bedroomPhrase: 1 -> 1-Bedroom", bedroomPhrase(1) === "1-Bedroom");
ok("bedroomPhrase: 3 -> 3-Bedroom", bedroomPhrase(3) === "3-Bedroom");
ok("bedroomPhrase: null -> null", bedroomPhrase(null) === null);

// --- shortenAddressForTitle ------------------------------------------------
ok(
  "shortAddr: strips 'unit - main' tail",
  shortenAddressForTitle("506 Manning Avenue unit - main") === "506 Manning Avenue",
);
ok(
  "shortAddr: strips Unit N",
  shortenAddressForTitle("123 Main St, Unit 4") === "123 Main St",
);
ok(
  "shortAddr: strips bare '- basement' label",
  shortenAddressForTitle("88 King St - basement") === "88 King St",
);
ok("shortAddr: keeps a clean address", shortenAddressForTitle("5 Oak Ave") === "5 Oak Ave");
ok("shortAddr: blank -> ''", shortenAddressForTitle(null) === "");

// --- buildHeadline (persuasive) --------------------------------------------
ok(
  "headline: leads with description descriptors + bedroom + short address",
  buildHeadline({
    address: "506 Manning Avenue unit - main",
    beds: 1,
    baths: 1,
    description: "Bright corner one-bedroom with great light.",
  }) === "Bright Corner 1-Bedroom at 506 Manning Avenue",
);
ok(
  "headline: no descriptors -> bedroom + Rental noun + address + true feature tail",
  buildHeadline({
    address: "5 Oak Ave",
    beds: 1,
    baths: 1,
    features: { air_conditioning: true },
  }) === "1-Bedroom Rental at 5 Oak Ave With Air Conditioning",
);
ok(
  "headline: never invents a feature the unit lacks",
  !/Air Conditioning|Parking|Laundry/.test(
    buildHeadline({ address: "5 Oak Ave", beds: 2, baths: 1 }),
  ),
);
ok(
  "headline: studio with no address",
  buildHeadline({ address: "", beds: 0, baths: 1 }) === "Studio Rental",
);
ok(
  "headline: two true features join with 'and'",
  buildHeadline({
    address: "5 Oak Ave",
    beds: 2,
    baths: 1,
    features: { air_conditioning: true, parking: "1 spot" },
  }) === "2-Bedroom Rental at 5 Oak Ave With Air Conditioning and Parking",
);
ok(
  "headline: rent is NOT in the title (lives in the body)",
  !buildHeadline({ address: "5 Oak Ave", beds: 1, baths: 1, rentCents: 185000 }).includes("$"),
);
ok(
  "headline: uses hyphen not em dash",
  !/[–—]/.test(
    buildHeadline({ address: "123 Main St", beds: 2, baths: 1, description: "open—concept" }),
  ),
);

// --- buildListingCopy ------------------------------------------------------
const fullInput: ListingCopyInput = {
  businessName: "Maple Door Rentals",
  address: "123 Main St, Unit 4",
  rentCents: 185000,
  beds: 2,
  baths: 1,
  description: "Bright corner suite with great light.",
  publicUrl: "https://vacantless-app.vercel.app/r/abc123",
  features: {
    available_date: "2026-08-01",
    sqft: 850,
    floor: "3rd",
    parking: "1 spot",
    laundry: "in_suite",
    air_conditioning: true,
    balcony: true,
    heat_included: true,
    water_included: true,
  },
  now: NOW,
};

const generic = buildListingCopy(fullInput, "generic");
ok("copy: portal echoed", generic.portal === "generic");
ok("copy: title length-capped (generic 120)", generic.title.length <= 120);
ok("copy: body includes rent", generic.body.includes("$1,850/month"));
ok("copy: body includes availability", generic.body.includes("Available Aug 1"));
ok("copy: body includes sqft", generic.body.includes("850 sq ft"));
ok("copy: body includes amenity", generic.body.includes("Air conditioning"));
ok("copy: body includes utilities derived", generic.body.includes("Heat & water included in rent."));
ok("copy: body includes description", generic.body.includes("Bright corner suite"));
ok(
  "copy: description LEADS the body (persuasive spine first)",
  generic.body.startsWith("Bright corner suite with great light."),
);
ok(
  "copy: with a description the field-summary opener is dropped",
  !/^(?:Studio|\d bed)[^\n]*rental at/i.test(generic.body),
);
ok("copy: body includes link", generic.body.includes("https://vacantless-app.vercel.app/r/abc123"));
ok("copy: body signs off with business", generic.body.includes("- Maple Door Rentals"));
ok("copy: no em dashes anywhere", !/[–—]/.test(generic.body) && !/[–—]/.test(generic.title));

// Kijiji title cap is 64.
const kijiji = buildListingCopy(fullInput, "kijiji");
ok("copy: kijiji title <= 64", kijiji.title.length <= 64);

// Facebook puts the link on its own line, under a Marketplace-specific CTA
// (links break in DMs / get stripped inline, so it says message-or-paste).
const fb = buildListingCopy(fullInput, "facebook");
ok("copy: facebook link on own line", fb.body.includes("browser:\n\nhttps://"));
ok(
  "copy: facebook CTA tells renter to message us",
  /message us/i.test(fb.body),
);
ok(
  "copy: facebook CTA mentions copying the link into a browser",
  /copy this link into your browser/i.test(fb.body),
);

// Per-portal CTA differs (the "tuned for each site" claim is real): every
// non-Facebook portal uses the default book-or-inquire CTA; Facebook does not.
const kijijiCopy = buildListingCopy(fullInput, "kijiji");
ok(
  "copy: kijiji uses default CTA",
  kijijiCopy.body.includes("Book a viewing or send an inquiry:"),
);
ok(
  "copy: facebook does NOT use the default CTA",
  !fb.body.includes("Book a viewing or send an inquiry:"),
);
ok(
  "copy: generic uses default CTA",
  generic.body.includes("Book a viewing or send an inquiry:"),
);

// --- structured listing platforms (Rentals.ca / Zumper / Viewit) -----------
// These have their OWN beds/baths/sqft/amenity fields, so the generated body
// drops the redundant spec + feature lines and reads as a narrative.
const rentalsCa = buildListingCopy(fullInput, "rentals_ca");
ok(
  "copy: rentals.ca body LEADS with the description",
  rentalsCa.body.startsWith("Bright corner suite with great light."),
);
ok(
  "copy: rentals.ca drops the redundant spec line (sqft is a structured field)",
  !rentalsCa.body.includes("850 sq ft"),
);
ok(
  "copy: rentals.ca drops the redundant Features line",
  !rentalsCa.body.includes("Features:"),
);
ok(
  "copy: rentals.ca keeps price (a useful anchor)",
  rentalsCa.body.includes("$1,850/month"),
);
ok(
  "copy: rentals.ca keeps the utilities disclosure",
  rentalsCa.body.includes("Heat & water included in rent."),
);
ok(
  "copy: rentals.ca keeps the inquiry link",
  rentalsCa.body.includes("https://vacantless-app.vercel.app/r/abc123"),
);
ok(
  "copy: structured platforms use the structured CTA",
  rentalsCa.body.includes("Book a viewing or ask us a question:"),
);
ok(
  "copy: rentfaster + zumper + viewit also drop the spec line",
  !buildListingCopy(fullInput, "rentfaster").body.includes("850 sq ft") &&
    !buildListingCopy(fullInput, "zumper").body.includes("850 sq ft") &&
    !buildListingCopy(fullInput, "viewit").body.includes("850 sq ft"),
);
// Classifieds keep the full self-contained dump (regression guard).
ok(
  "copy: kijiji (classified) STILL includes the spec line + Features",
  kijiji.body.includes("850 sq ft") && kijiji.body.includes("Features:"),
);

// Sparse unit still renders cleanly.
const sparse = buildListingCopy(
  { address: "9 Elm", beds: 1, baths: 1 },
  "kijiji",
);
ok("copy: sparse has title", sparse.title.length > 0);
ok(
  "copy: no-description body falls back to the field-summary opener",
  sparse.body.startsWith("1 bed, 1 bath rental at 9 Elm."),
);
ok("copy: sparse falls back to contact CTA", sparse.body.includes("Contact us to book a viewing."));
ok("copy: sparse no available-date still says Available now", sparse.body.includes("Available now"));

const closedNoUrl = buildListingCopy(
  {
    ...fullInput,
    publicUrl: null,
    fallbackCta: "This rental is paused and is not accepting inquiries right now.",
  },
  "generic",
);
ok(
  "copy: no-url fallback CTA can be status-safe",
  closedNoUrl.body.includes("This rental is paused") &&
    !closedNoUrl.body.includes("Contact us to book a viewing."),
);

// utilities NOT hardcoded: a unit with no included utilities omits the line.
const noUtils = buildListingCopy(
  { address: "1 A St", beds: 1, baths: 1, features: { furnished: false } },
  "generic",
);
ok("copy: no utilities line when none included", !noUtils.body.includes("in rent."));

// buildAllListingCopy returns one per portal.
const all = buildAllListingCopy(fullInput);
ok("buildAll: one per portal", all.length === COPY_PORTAL_KEYS.length);
ok("buildAll: each has title+body", all.every((c) => c.title.length > 0 && c.body.length > 0));

// --- stripEmDashes ---------------------------------------------------------
ok("stripEmDashes: em -> hyphen", stripEmDashes("a — b") === "a - b");
ok("stripEmDashes: en -> hyphen", stripEmDashes("a – b") === "a - b");
ok("stripEmDashes: leaves hyphen", stripEmDashes("a - b") === "a - b");

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-copy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
