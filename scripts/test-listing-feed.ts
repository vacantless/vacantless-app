// Unit tests for the pure listing-syndication-feed builder (lib/listing-feed.ts).
// Run: npx tsx scripts/test-listing-feed.ts
import {
  rentDollars,
  formatBaths,
  formatBeds,
  formatSqftValue,
  escapeXmlText,
  escapeXmlAttr,
  stripLinks,
  clampDescription,
  listingFeedReadiness,
  summarizeFeed,
  buildListingItemXml,
  buildListingFeedXml,
  MAX_DESCRIPTION_CHARS,
  MAX_PHOTOS,
  type FeedListingInput,
  type FeedOrgInput,
} from "../lib/listing-feed";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- rentDollars ------------------------------------------------------------
ok("rentDollars cents -> dollars", rentDollars(125000) === "1250.00");
ok("rentDollars rounds", rentDollars(125049) === "1250.49");
ok("rentDollars null -> null", rentDollars(null) === null);
ok("rentDollars zero -> null", rentDollars(0) === null);
ok("rentDollars negative -> null", rentDollars(-5) === null);

// --- formatBaths / beds / sqft ---------------------------------------------
ok("formatBaths number", formatBaths(1.5) === "1.5");
ok("formatBaths integer -> .0", formatBaths(2) === "2.0");
ok("formatBaths string from jsonb", formatBaths("1.0") === "1.0");
ok("formatBaths null -> null", formatBaths(null) === null);
ok("formatBeds 0 = studio kept", formatBeds(0) === "0");
ok("formatBeds null -> null", formatBeds(null) === null);
ok("formatSqftValue rounds", formatSqftValue(799.6) === "800");
ok("formatSqftValue zero -> null", formatSqftValue(0) === null);

// --- XML escaping -----------------------------------------------------------
ok("escapeXmlText ampersand", escapeXmlText("A & B") === "A &amp; B");
ok(
  "escapeXmlText angle brackets",
  escapeXmlText("<b>x</b>") === "&lt;b&gt;x&lt;/b&gt;",
);
ok(
  "escapeXmlAttr quotes",
  escapeXmlAttr(`he said "hi" it's`) ===
    "he said &quot;hi&quot; it&apos;s",
);
ok(
  "escapeXmlAttr also escapes amp first (no double-escape)",
  escapeXmlAttr("a&b") === "a&amp;b",
);

// --- stripLinks -------------------------------------------------------------
ok(
  "stripLinks removes http url",
  stripLinks("See https://example.com/x now").trim() === "See now",
);
ok(
  "stripLinks removes www host",
  !stripLinks("Visit www.kijiji.ca today").includes("www."),
);
ok("stripLinks leaves plain text", stripLinks("Nice 2 bed unit") === "Nice 2 bed unit");

// --- clampDescription -------------------------------------------------------
ok("clampDescription null -> null", clampDescription(null) === null);
ok("clampDescription blank -> null", clampDescription("   ") === null);
ok(
  "clampDescription strips links",
  clampDescription("Call us at https://x.com please")?.includes("http") === false,
);
const longDesc = "word ".repeat(2000); // 10000 chars
const clamped = clampDescription(longDesc);
ok("clampDescription enforces max", (clamped?.length ?? 0) <= MAX_DESCRIPTION_CHARS);
ok(
  "clampDescription collapses whitespace",
  clampDescription("a    b\t\tc") === "a b c",
);
ok(
  "clampDescription strips control chars",
  clampDescription("a\u0007bc") === "abc",
);

// --- readiness --------------------------------------------------------------
const fullListing: FeedListingInput = {
  id: "p1",
  address: "123 Main St, Unit 4, Windsor ON",
  rent_cents: 125000,
  beds: 2,
  baths: 1.5,
  description: "Bright 2-bed unit with parking.",
  photos: ["https://cdn/x/cover.jpg", "https://cdn/x/2.jpg"],
  available_date: "2026-07-01",
  sqft: 800,
  floor: "2nd",
  parking: "1 spot",
  laundry: "in_suite",
  air_conditioning: true,
  balcony: true,
  furnished: false,
  pets_cats: true,
  pets_dogs: true,
  pets_dog_size: "medium",
  heat_included: true,
  hydro_included: false,
  water_included: true,
};

ok("full listing is ready", listingFeedReadiness(fullListing).ready === true);

const noPrice = { ...fullListing, rent_cents: null };
ok("missing price not ready", listingFeedReadiness(noPrice).ready === false);
ok(
  "missing price reason",
  listingFeedReadiness(noPrice).missing.includes("price"),
);
const noPhoto = { ...fullListing, photos: [] };
ok("missing photo not ready", listingFeedReadiness(noPhoto).missing.includes("photo"));
const noDesc = { ...fullListing, description: "  " };
ok(
  "missing description not ready",
  listingFeedReadiness(noDesc).missing.includes("description"),
);
const noAddr = { ...fullListing, address: null };
ok("missing address not ready", listingFeedReadiness(noAddr).missing.includes("address"));

// --- summarizeFeed ----------------------------------------------------------
const org: FeedOrgInput = {
  name: "Agile Real Estate Group",
  slug: "agile",
  contact_phone: "+1 226-773-7555",
  contact_email: "rentals@agileonline.ca",
};
const summary = summarizeFeed(org, [fullListing, noPrice, noPhoto]);
ok("summary total counts all", summary.total === 3);
ok("summary ready count", summary.readyCount === 1);
ok("summary skipped count", summary.skippedCount === 2);
ok("summary org phone present", summary.orgPhoneMissing === false);
ok(
  "summary org phone missing flagged",
  summarizeFeed({ ...org, contact_phone: null }, []).orgPhoneMissing === true,
);

// --- buildListingItemXml ----------------------------------------------------
const item = buildListingItemXml(fullListing, {
  baseUrl: "https://vacantless-app.vercel.app",
  propertyType: "apartment",
  country: "CA",
});
ok("item has external_id", item.includes("<external_id>p1</external_id>"));
ok(
  "item url points at /r/<id>",
  item.includes("<url>https://vacantless-app.vercel.app/r/p1</url>"),
);
ok("item title is address", item.includes("123 Main St, Unit 4, Windsor ON"));
ok("item rent currency + period", item.includes('<rent currency="CAD" period="monthly">1250.00</rent>'));
ok("item bedrooms", item.includes("<bedrooms>2</bedrooms>"));
ok("item bathrooms", item.includes("<bathrooms>1.5</bathrooms>"));
ok("item square_feet", item.includes("<square_feet>800</square_feet>"));
ok("item available_date", item.includes("<available_date>2026-07-01</available_date>"));
ok("item property_type", item.includes("<property_type>apartment</property_type>"));
ok("item status active", item.includes("<status>active</status>"));
ok("item pets_allowed true", item.includes("<pets_allowed>true</pets_allowed>"));
ok("item cats_allowed true", item.includes("<cats_allowed>true</cats_allowed>"));
ok("item dogs_allowed true", item.includes("<dogs_allowed>true</dogs_allowed>"));
ok(
  "item dog_size_limit medium",
  item.includes("<dog_size_limit>medium</dog_size_limit>"),
);
ok("item furnished false", item.includes("<furnished>false</furnished>"));
ok("item utilities heat", item.includes("<utility>Heat</utility>"));
ok("item utilities water", item.includes("<utility>Water</utility>"));
ok("item no hydro utility (not included)", !item.includes("<utility>Hydro</utility>"));
ok("item amenity AC", item.includes("<amenity>Air conditioning</amenity>"));
ok("item amenity balcony", item.includes("<amenity>Balcony</amenity>"));
ok("item photos block", item.includes('<photo order="1">https://cdn/x/cover.jpg</photo>'));
ok("item photo order 2", item.includes('<photo order="2">https://cdn/x/2.jpg</photo>'));
ok("item country", item.includes("<country>CA</country>"));

// Pets: no pets -> all false, no dog_size_limit element.
const noPets = buildListingItemXml(
  { ...fullListing, pets_cats: false, pets_dogs: false, pets_dog_size: null },
  { baseUrl: "https://x.test", propertyType: "apartment", country: "CA" },
);
ok("no-pets pets_allowed false", noPets.includes("<pets_allowed>false</pets_allowed>"));
ok("no-pets cats_allowed false", noPets.includes("<cats_allowed>false</cats_allowed>"));
ok("no-pets dogs_allowed false", noPets.includes("<dogs_allowed>false</dogs_allowed>"));
ok("no-pets omits dog_size_limit", !noPets.includes("<dog_size_limit>"));
// Dogs with size 'any' -> no dog_size_limit element (no real limit).
const anyDog = buildListingItemXml(
  { ...fullListing, pets_cats: false, pets_dogs: true, pets_dog_size: "any" },
  { baseUrl: "https://x.test", propertyType: "apartment", country: "CA" },
);
ok("dog size 'any' omits dog_size_limit", !anyDog.includes("<dog_size_limit>"));
ok("dog size 'any' dogs_allowed true", anyDog.includes("<dogs_allowed>true</dogs_allowed>"));

// XSS / injection: a malicious address must be escaped, not break the doc.
const evil = buildListingItemXml(
  { ...fullListing, address: `Evil</title><inject>" & <x>` },
  { baseUrl: "https://x.test", propertyType: "apartment", country: "CA" },
);
ok("evil address escaped <", !evil.includes("<inject>"));
ok("evil address escaped &", evil.includes("&amp;"));

// Photo cap at 50.
const manyPhotos = { ...fullListing, photos: Array.from({ length: 60 }, (_, i) => `https://cdn/${i}.jpg`) };
const itemMany = buildListingItemXml(manyPhotos, { baseUrl: "https://x.test", propertyType: "apartment", country: "CA" });
ok(
  "photos capped at MAX_PHOTOS",
  (itemMany.match(/<photo /g) ?? []).length === MAX_PHOTOS,
);

// --- buildListingFeedXml ----------------------------------------------------
const feed = buildListingFeedXml({
  org,
  listings: [fullListing, noPrice, noPhoto],
  baseUrl: "https://vacantless-app.vercel.app",
  generatedAt: "2026-06-18T18:12:00.000Z",
});
ok("feed has xml declaration", feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
ok("feed root element", feed.includes("<rental_listings"));
ok("feed source attr", feed.includes('source="Vacantless"'));
ok("feed provider attr", feed.includes('provider="Agile Real Estate Group"'));
ok("feed provider_id attr", feed.includes('provider_id="agile"'));
ok("feed generated_at attr", feed.includes('generated_at="2026-06-18T18:12:00.000Z"'));
ok("feed count only ready", feed.includes('count="1"'));
ok("feed contact phone", feed.includes("<phone>+1 226-773-7555</phone>"));
ok("feed contact email", feed.includes("<email>rentals@agileonline.ca</email>"));
ok("feed includes exactly one listing", (feed.match(/<listing>/g) ?? []).length === 1);
ok("feed closes root", feed.trim().endsWith("</rental_listings>"));

// Empty feed (no ready listings) is still well-formed.
const emptyFeed = buildListingFeedXml({
  org,
  listings: [noPrice],
  baseUrl: "https://x.test",
  generatedAt: "2026-06-18T00:00:00.000Z",
});
ok("empty feed count 0", emptyFeed.includes('count="0"'));
ok("empty feed has no <listing>", !emptyFeed.includes("<listing>"));
ok("empty feed still closes root", emptyFeed.trim().endsWith("</rental_listings>"));

// Well-formedness smoke test: tag balance for the main containers.
function countTag(s: string, name: string): [number, number] {
  const open = (s.match(new RegExp(`<${name}(?:\\s|>)`, "g")) ?? []).length;
  const close = (s.match(new RegExp(`</${name}>`, "g")) ?? []).length;
  return [open, close];
}
for (const name of ["rental_listings", "listing", "address", "photos", "contact", "amenities", "utilities_included"]) {
  const [o, c] = countTag(feed, name);
  ok(`feed ${name} tags balanced`, o === c);
}

// ----------------------------------------------------------------------------
console.log(`listing-feed: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
