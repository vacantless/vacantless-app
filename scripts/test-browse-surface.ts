// Unit tests for the pure public browse-surface helper.
// Run: npx tsx scripts/test-browse-surface.ts
import assert from "node:assert/strict";
import {
  BROWSE_CITY_ALLOWLIST,
  browseReady,
  buildBrowseIndex,
  cityFromSlug,
  citySlug,
  detailHref,
  parseCityFromAddress,
  type BrowseListing,
  type BrowseProvider,
} from "../lib/browse-surface";

const GOOD_DESCRIPTION =
  "Bright and spacious rental with clean finishes, useful storage, and a practical layout near daily amenities.";

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
    ...overrides,
  };
}

function provider(
  listings: BrowseListing[],
  orgName: string | null = "Agile Real Estate Group",
): BrowseProvider {
  return {
    org: { name: orgName },
    listings,
  };
}

// Readiness reuse: failing the feed floor keeps the listing off browse.
assert.equal(browseReady(listing({ rent_cents: null })), false);
assert.equal(buildBrowseIndex([provider([listing({ photos: [] })])]).totalCount, 0);
assert.equal(
  buildBrowseIndex([provider([listing({ description: "Nice unit." })])])
    .totalCount,
  0,
);

// Browse does not require the network feed's org contact phone; cards route to /r.
const noPhoneIndex = buildBrowseIndex([provider([listing()], null)]);
assert.equal(noPhoneIndex.totalCount, 1);
assert.equal(noPhoneIndex.cities[0]?.listings[0]?.orgName, "Vacantless landlord");

// Ontario-first city parsing.
assert.equal(
  parseCityFromAddress("506 Manning Ave, Toronto, ON M6G 2V9"),
  "Toronto",
);
assert.equal(
  parseCityFromAddress("55 Queen St, St. Catharines, ON L2R 5G8"),
  "St. Catharines",
);
assert.equal(
  parseCityFromAddress("123 Riverside Dr Windsor ON N9A 1A1"),
  "Windsor",
);
assert.equal(parseCityFromAddress("not a city-bearing address"), null);
assert.equal(parseCityFromAddress(null), null);

// Slugs round-trip exactly for the allowlist; junk stays null.
for (const city of BROWSE_CITY_ALLOWLIST) {
  assert.equal(cityFromSlug(citySlug(city)), city);
}
assert.equal(citySlug("St. Catharines"), "st-catharines");
assert.equal(cityFromSlug("toronto-on"), null);
assert.equal(cityFromSlug(""), null);

// Grouping and sorting are deterministic: cities by count/name, Ontario last,
// listings inside a city by rent ascending.
const mixed = [
  provider([
    listing({ id: "toronto-high", rent_cents: 310000 }),
    listing({ id: "ottawa", address: "9 Bank St, Ottawa, ON", rent_cents: 230000 }),
    listing({
      id: "unknown",
      address: "Lot 7 Rural Route",
      rent_cents: 120000,
    }),
    listing({ id: "toronto-low", rent_cents: 210000 }),
  ]),
];
const first = buildBrowseIndex(mixed);
const second = buildBrowseIndex(mixed);
assert.deepEqual(second, first);
assert.deepEqual(
  first.cities.map((city) => city.city),
  ["Toronto", "Ottawa", "Ontario"],
);
assert.deepEqual(
  first.cities[0]?.listings.map((entry) => entry.id),
  ["toronto-low", "toronto-high"],
);
assert.equal(first.cities.at(-1)?.city, "Ontario");

// Card fields.
const torontoLow = first.cities[0]?.listings[0];
assert.equal(torontoLow?.coverPhoto, "https://cdn.example/cover.jpg");
assert.equal(torontoLow?.citySlug, "toronto");
assert.equal(torontoLow?.specLine.includes("2 beds"), true);
assert.equal(detailHref("listing-1"), "/r/listing-1?src=network");

// Missing optional unit fields should not throw.
const sparseIndex = buildBrowseIndex([
  provider([
    listing({
      id: "sparse",
      address: "10 James St, Hamilton, ON",
      beds: null,
      baths: null,
      sqft: undefined,
      floor: undefined,
      parking: undefined,
      laundry: undefined,
      air_conditioning: undefined,
      balcony: undefined,
      furnished: undefined,
      pet_friendly: undefined,
      pets_cats: undefined,
      pets_dogs: undefined,
      pets_dog_size: undefined,
      pets_notes: undefined,
      heat_included: undefined,
      hydro_included: undefined,
      water_included: undefined,
      virtual_tour_url: undefined,
    }),
  ]),
]);
assert.equal(sparseIndex.totalCount, 1);
assert.equal(sparseIndex.cities[0]?.listings[0]?.specLine, "");

assert.deepEqual(buildBrowseIndex([]), { cities: [], totalCount: 0 });
assert.deepEqual(buildBrowseIndex(null), { cities: [], totalCount: 0 });

console.log("test-browse-surface: ok");
