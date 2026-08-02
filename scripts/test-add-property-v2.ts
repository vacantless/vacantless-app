// Unit tests for the pure Add Property v2 form/readiness mapping.
// Run: npx tsx scripts/test-add-property-v2.ts

import {
  EMPTY_ADD_PROPERTY_V2_DRAFT,
  addPropertyV2DraftFromListing,
  buildAddPropertyV2ReadinessInput,
  draftFactsFromAddPropertyV2,
} from "../lib/add-property-v2";
import { emptyListingDraft, type ListingDraft } from "../lib/listing-extract";
import { emptyParsedListing } from "../lib/mls-import";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const parsed = {
  ...emptyParsedListing(),
  address: "12 Donwoods Dr, Toronto ON",
  rentCents: 245000,
  beds: 3,
  baths: 1.5,
  propertyType: "Condo Apartment",
  sqft: 1200,
  parking: "1 garage space",
  description:
    "Bright three-bedroom home with a renovated kitchen, private outdoor space, parking, and easy access to transit.",
  availableDate: "2026-09-01",
  virtualTourUrl: "https://www.youtube.com/watch?v=abc12345678",
  airConditioning: true,
  balcony: true,
  heatIncluded: true,
  foundFields: [
    "Address",
    "Rent",
    "Beds",
    "Baths",
    "Square footage",
    "Parking",
    "Description",
    "Available date",
    "Virtual tour",
    "Air conditioning",
    "Balcony",
    "Heat included",
  ],
};

const ai: ListingDraft = {
  ...emptyListingDraft(),
  internetIncluded: true,
  cableIncluded: false,
  amenities: ["dishwasher", "gym"],
  parkingType: "garage",
  parkingCount: 1,
  heatingType: "forced_air",
  securityDepositCents: 245000,
  videoUrl: "https://vimeo.com/123456789",
};

const prefill = addPropertyV2DraftFromListing(parsed, ai);
ok("prefill carries address", prefill.draft.address === "12 Donwoods Dr, Toronto ON");
ok("prefill converts rent cents to dollars", prefill.draft.rent === "2450");
ok("prefill carries fractional baths", prefill.draft.baths === "1.5");
ok("prefill maps property type to unit type", prefill.draft.unit_type === "condo");
ok("prefill lists property type", prefill.filledFields.includes("Property type"));
ok("prefill carries existing tour URL", prefill.draft.virtual_tour_url?.includes("youtube"));
ok("prefill carries AI internet true", prefill.draft.internet_included === "true");
ok("prefill carries AI cable false", prefill.draft.cable_included === "false");
ok("prefill normalizes amenities", prefill.draft.amenities.join("|") === "dishwasher|gym");
ok("prefill lists Lane A fields", prefill.filledFields.includes("Amenities"));
ok("prefill lists video URL", prefill.filledFields.includes("Video URL"));

const readiness = buildAddPropertyV2ReadinessInput(prefill.draft, {
  photoCount: 2,
  availabilityWindowCount: 1,
  replyToEmail: "rentals@example.com",
  contactPhone: "+1 416-555-0100",
});
ok("readiness previews as available", readiness.status === "available");
ok("readiness maps rent cents", readiness.rentCents === 245000);
ok("readiness maps selected photo count", readiness.photoCount === 2);
ok("readiness maps included internet", readiness.internet_included === true);
ok("readiness maps excluded cable", readiness.cable_included === false);
ok("readiness maps parking count", readiness.parking_count === 1);
ok("readiness keeps normalized amenities", readiness.amenities?.join("|") === "dishwasher|gym");

const bare = buildAddPropertyV2ReadinessInput(EMPTY_ADD_PROPERTY_V2_DRAFT);
ok("empty draft address null", bare.address === null);
ok("empty draft rent null", bare.rentCents === null);
ok("empty draft defaults zero photos", bare.photoCount === 0);

const facts = draftFactsFromAddPropertyV2({
  ...prefill.draft,
  pets_cats: "true",
  pets_dogs: "",
});
ok("draft facts map rent", facts.rent_cents === 245000);
ok("draft facts derive pet friendly", facts.pet_friendly === true);
ok("draft facts keep heat included", facts.heat_included === true);

if (failed > 0) {
  console.error(`add-property-v2: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`add-property-v2: ${passed} passed, ${failed} failed`);
