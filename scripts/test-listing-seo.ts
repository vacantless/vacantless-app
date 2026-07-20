// Unit tests for public listing SEO + browse attribution helpers.
// Run: npx tsx scripts/test-listing-seo.ts
import assert from "node:assert/strict";
import {
  buildListingJsonLd,
  buildListingMetaDescription,
  buildListingMetaTitle,
  buildSitemapEntries,
  jsonLdScriptText,
  leadSourceHintFromParam,
} from "../lib/listing-seo";
import type { BrowseListing, BrowseProvider } from "../lib/browse-surface";

const GOOD_DESCRIPTION =
  "Bright and spacious rental with clean finishes, useful storage, large windows, and a practical layout near daily amenities.";

function listing(overrides: Partial<BrowseListing> = {}): BrowseListing {
  return {
    id: "listing-1",
    address: "506 Manning Ave, Toronto, ON M6G 2V9",
    rent_cents: 250000,
    beds: 2,
    baths: 1,
    description: GOOD_DESCRIPTION,
    photos: ["https://cdn.example/cover.jpg", "https://cdn.example/two.jpg"],
    available_date: null,
    sqft: 850,
    floor: "2nd",
    parking: "1 spot",
    laundry: "in_suite",
    air_conditioning: true,
    balcony: true,
    furnished: false,
    pet_friendly: true,
    pets_cats: true,
    pets_dogs: true,
    pets_dog_size: "small",
    heat_included: true,
    hydro_included: false,
    water_included: true,
    ...overrides,
  };
}

function provider(listings: BrowseListing[]): BrowseProvider {
  return {
    org: { name: "Agile Real Estate Group" },
    listings,
  };
}

const title = buildListingMetaTitle(listing());
assert.equal(
  title,
  "2 beds 1 bath 850 sq ft 2nd floor Parking: 1 spot - 506 Manning Ave, Toronto, ON M6G 2V9 - $2,500/mo",
);
assert.equal(buildListingMetaTitle(listing({ address: null })), "2 beds 1 bath 850 sq ft 2nd floor Parking: 1 spot - $2,500/mo");
assert.equal(
  buildListingMetaTitle(
    listing({
      address: null,
      rent_cents: null,
      beds: null,
      baths: null,
      sqft: null,
      floor: null,
      parking: null,
    }),
  ),
  "Rental listing",
);
assert.equal(title.includes("null"), false);
assert.equal(title.includes("undefined"), false);

const fallbackDescription = buildListingMetaDescription(
  listing({ description: null }),
);
assert.equal(
  fallbackDescription,
  "View this rental listing and send an inquiry through Vacantless.",
);
assert.equal(fallbackDescription.length > 0, true);
assert.equal(fallbackDescription.includes("null"), false);
assert.equal(fallbackDescription.includes("undefined"), false);

const longRawDescription =
  "This bright rental has oversized windows, clean finishes, useful storage, a practical kitchen, thoughtful bedrooms, and transit nearby. ".repeat(3);
const longDescription = buildListingMetaDescription(
  listing({ description: longRawDescription }),
);
assert.equal(longDescription.length <= 160, true);
assert.equal(longDescription.endsWith("..."), true);
const truncatedPrefix = longDescription.slice(0, -3);
assert.equal(longRawDescription.startsWith(truncatedPrefix), true);
assert.equal(longRawDescription.at(truncatedPrefix.length), " ");

const jsonLd = buildListingJsonLd(listing(), {
  canonicalUrl: "https://app.vacantless.com/r/listing-1",
});
assert.equal(jsonLd["@type"], "Apartment");
assert.equal(jsonLd.url, "https://app.vacantless.com/r/listing-1");
assert.deepEqual(jsonLd.image, [
  "https://cdn.example/cover.jpg",
  "https://cdn.example/two.jpg",
]);
assert.equal((jsonLd.address as Record<string, unknown>).addressLocality, "Toronto");
assert.equal((jsonLd.offers as Record<string, unknown>).price, "2500.00");
assert.equal((jsonLd.offers as Record<string, unknown>).priceCurrency, "CAD");
assert.equal(
  (jsonLd.offers as Record<string, unknown>).availability,
  "https://schema.org/InStock",
);
assert.equal(jsonLd.numberOfBedrooms, 2);
assert.equal(jsonLd.numberOfBathroomsTotal, 1);
assert.deepEqual(jsonLd.floorSize, {
  "@type": "QuantitativeValue",
  value: 850,
  unitText: "sq ft",
});

const sparseJsonLd = buildListingJsonLd(
  listing({
    address: "Lot 7 Rural Route",
    rent_cents: null,
    beds: null,
    baths: null,
    sqft: null,
    photos: null,
  }),
  { canonicalUrl: "https://app.vacantless.com/r/sparse" },
);
assert.equal("image" in sparseJsonLd, false);
assert.equal("numberOfBedrooms" in sparseJsonLd, false);
assert.equal("numberOfBathroomsTotal" in sparseJsonLd, false);
assert.equal("floorSize" in sparseJsonLd, false);
assert.equal(
  "addressLocality" in (sparseJsonLd.address as Record<string, unknown>),
  false,
);
assert.equal("price" in (sparseJsonLd.offers as Record<string, unknown>), false);
assert.equal(JSON.stringify(sparseJsonLd).includes("null"), false);

const escaped = jsonLdScriptText({ name: "</script><img src=x>" });
assert.equal(escaped.toLowerCase().includes("</script"), false);
assert.equal(escaped.includes("\\u003c/script>"), true);

const sitemap = buildSitemapEntries(
  [
    provider([
      listing({
        id: "b-toronto",
        address: "506 Manning Ave, Toronto, ON M6G 2V9",
      }),
      listing({
        id: "a-hamilton",
        address: "10 James St, Hamilton, ON L8P 1A1",
      }),
      listing({
        id: "c-unparseable",
        address: "Lot 7 Rural Route",
      }),
      listing({
        id: "z-not-ready",
        photos: [],
      }),
    ]),
  ],
  { baseUrl: "https://app.vacantless.com/" },
);
assert.deepEqual(
  sitemap.map((entry) => entry.url),
  [
    "https://app.vacantless.com/rentals",
    "https://app.vacantless.com/rentals/hamilton",
    "https://app.vacantless.com/rentals/toronto",
    "https://app.vacantless.com/r/a-hamilton",
    "https://app.vacantless.com/r/b-toronto",
    "https://app.vacantless.com/r/c-unparseable",
  ],
);
assert.deepEqual(
  buildSitemapEntries([provider([listing({ photos: [] })])], {
    baseUrl: "https://app.vacantless.com",
  }),
  [{ url: "https://app.vacantless.com/rentals" }],
);

assert.equal(leadSourceHintFromParam("network"), "network");
assert.equal(leadSourceHintFromParam("Network"), null);
assert.equal(leadSourceHintFromParam(" network "), null);
assert.equal(leadSourceHintFromParam("website"), null);
assert.equal(leadSourceHintFromParam(""), null);
assert.equal(leadSourceHintFromParam(["network"]), null);
assert.equal(leadSourceHintFromParam(null), null);

console.log("test-listing-seo: ok");
