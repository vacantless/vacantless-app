// Unit tests for the pure Add Property v2 form/readiness mapping.
// Run: npx tsx scripts/test-add-property-v2.ts

import {
  EMPTY_ADD_PROPERTY_V2_DRAFT,
  addPropertyV2DraftFromListing,
  buildAddPropertyV2ReadinessInput,
  draftFactsFromAddPropertyV2,
  listingLooksAgentListed,
  lowerLevelUnitFromText,
} from "../lib/add-property-v2";
import { PHOTO_MIN_BYTES, PHOTO_SAVE_BUDGET_BYTES, photoShrinkMessage, photoShrinkPlan, saveFailedMessage, tooBigToSaveMessage } from "../lib/photo-shrink";
import { readFileSync } from "node:fs";
import { parseUnitAddress, pickFolderForAddress } from "../lib/dropbox-import";
import { splitShootLinks } from "../lib/drive-import";
import { emptyListingDraft, type ListingDraft } from "../lib/listing-extract";
import { emptyParsedListing, parseMlsListing } from "../lib/mls-import";

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

// S733: "tenant pays hydro" in a pasted ad selects "Tenant pays", not "Unknown".
{
  const pays = {
    ...emptyParsedListing(),
    heatIncluded: true,
    waterIncluded: true,
    tenantPays: { heat: false, hydro: true, water: false },
  };
  const d = addPropertyV2DraftFromListing(pays, null).draft;
  ok("tenant pays hydro -> hydro select false", d.hydro_included === "false");
  ok("heat included stays true", d.heat_included === "true");
  ok("no mention stays Unknown", addPropertyV2DraftFromListing(emptyParsedListing(), null).draft.hydro_included === "");
}

// S827b: a basement rental on an MLS sheet (type "Detached") is a Basement
// apartment with its floor filled in; an agent's sheet reads as agent listed.
{
  const glen = {
    ...emptyParsedListing(),
    propertyType: "Detached",
    description: "One-bedroom lower-level apartment on a tree-lined street, with a private entrance.",
  };
  const d = addPropertyV2DraftFromListing(glen, null).draft;
  ok("lower-level apartment -> basement apartment", d.unit_type === "basement-apartment");
  ok("lower-level apartment -> floor", d.floor === "Lower level");
  const house = { ...emptyParsedListing(), propertyType: "Detached", description: "Whole house for rent with a finished basement and a big yard." };
  const h = addPropertyV2DraftFromListing(house, null).draft;
  ok("house with a finished basement stays a house", h.unit_type === "house" && h.floor === "");
  const condo = { ...emptyParsedListing(), propertyType: "Condo Apt", description: "Bright unit. The basement apartment next door is separate." };
  ok("a condo is not turned into a basement", addPropertyV2DraftFromListing(condo, null).draft.unit_type === "condo");
  ok("basement suite -> Basement", lowerLevelUnitFromText("Renovated basement suite near the subway.") === "Basement");
  ok("no remarks -> null", lowerLevelUnitFromText(null) === null);
  ok("MLS sheet is agent listed", listingLooksAgentListed("MLS#: C1234567\nList Brokerage: ROYAL LEPAGE") === true);
  ok("realtor.ca page is agent listed", listingLooksAgentListed("See it on realtor.ca today") === true);
  ok("a Kijiji ad is not agent listed", listingLooksAgentListed("2 bedroom for rent, call the owner") === false);
  const p0 = photoShrinkPlan(10);
  ok("ten photos all kept", p0.keep === 10 && p0.left === 0 && p0.perFileBytes * 10 <= PHOTO_SAVE_BUDGET_BYTES);
  const p1 = photoShrinkPlan(40);
  ok("forty photos: some wait for the rental page", p1.keep < 40 && p1.left === 40 - p1.keep && p1.perFileBytes >= PHOTO_MIN_BYTES);
  ok("no photos", photoShrinkPlan(0).keep === 0);
  ok("too big names the size", /23 MB/.test(tooBigToSaveMessage(23 * 1024 * 1024)) && /Not saved yet/.test(tooBigToSaveMessage(5e6)));
  ok("failed save says nothing was created", /did not save/.test(saveFailedMessage()));
  const form = readFileSync("app/dashboard/properties/new/add-property-form.tsx", "utf8");
  ok("form watches the save", form.includes("<SaveWatcher onFail=") && form.includes('role="alert"'));
  // S827b: a photographer's master Dropbox folder and an iGUIDE link.
  const master = [
    "3-50 Glenrose Ave/Gallery",
    "3-50 Glenrose Ave/High Res",
    "4-50 Glenrose Ave/Gallery",
    "4-50 Glenrose Ave/High Res",
    "B-50 Glenrose Ave/Gallery",
    "B-50 Glenrose Ave/High Res",
    "1200 Don Mills Rd 503/Gallery",
    "18 Shorncliffe Rd/Gallery",
  ];
  ok("unit B picks its own Gallery", pickFolderForAddress(master, "50 Glenrose Ave, Unit B, Toronto, ON") === "B-50 Glenrose Ave/Gallery");
  ok("unit 4 picks its own Gallery", pickFolderForAddress(master, "4-50 Glenrose Ave, Toronto") === "4-50 Glenrose Ave/Gallery");
  ok("no unit at a many-unit address asks", pickFolderForAddress(master, "50 Glenrose Ave, Toronto") === null);
  ok("unit not shot asks", pickFolderForAddress(master, "50 Glenrose Ave, Unit C, Toronto") === null);
  ok("house picks its Gallery", pickFolderForAddress(master, "18 Shorncliffe Rd, Toronto") === "18 Shorncliffe Rd/Gallery");
  ok("unit after the street name", pickFolderForAddress(["50 Glenrose Ave Unit B/Gallery", "50 Glenrose Ave Unit B/High Res"], "50 Glenrose Ave, Unit B, Toronto") === "50 Glenrose Ave Unit B/Gallery");
  ok("not the address: asks", pickFolderForAddress(master, "12 Main St, Toronto") === null);
  ok("500 Glenrose is not 50 Glenrose", pickFolderForAddress(["500 Glenrose Ave/Gallery"], "50 Glenrose Ave, Toronto") === null);
  const ua = parseUnitAddress("50 Glenrose Ave, Unit B, Toronto, ON");
  ok("address parts", !!ua && ua.number === "50" && ua.street === "glenrose" && ua.unit === "b");
  const links = splitShootLinks("https://www.dropbox.com/scl/fo/abc/xyz?rlkey=k&dl=0 https://youriguide.com/50_glenrose_ave_toronto_on/");
  ok("links: folder found", !!links.folder && links.folder.includes("dropbox.com"));
  ok("links: iGUIDE tour found", !!links.tour && links.tour.includes("youriguide.com"));
  const onlyTour = splitShootLinks("https://youriguide.com/50_glenrose_ave_toronto_on/");
  ok("tour only: no folder", onlyTour.folder === null && !!onlyTour.tour);
  ok("nothing pasted", splitShootLinks("").folder === null && splitShootLinks(null).tour === null);
  ok("form takes a Dropbox or Drive link", form.includes('name="photo_folder_url"'));
  const acts = readFileSync("app/dashboard/properties/actions.ts", "utf8");
  ok("create pulls from the link", /S827b: a Dropbox or Google Drive link on Add rental[\s\S]{0,1500}pullFolderPhotos\(/.test(acts));
  ok("form checks photo size before sending", form.includes("tooBigToSaveMessage(bytes)"));
  ok("no em dashes in the new copy", !/\u2014/.test(saveFailedMessage() + tooBigToSaveMessage(1e7)));
  ok("message names what was left", /2 more did not fit/.test(photoShrinkMessage(15, 2, 0)));
  const sheet = parseMlsListing("Address: 50 Glenrose Ave\nClient Remks: One-bedroom lower-level apartment with large windows and a private entrance.\nExtras:\nInclusions:\nExclusions:\nRental Items:");
  ok("empty sheet labels stay out of the description", !!sheet.description && !/Extras|Inclusions|Rental Items/.test(sheet.description));
  const sameLine = parseMlsListing("Client Remks: One-bedroom lower-level apartment with large windows. Extras: Inclusions: Exclusions: Rental Items:");
  ok("empty labels on the remarks line are trimmed", !!sameLine.description && !/Extras|Rental Items/.test(sameLine.description));
}

if (failed > 0) {
  console.error(`add-property-v2: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`add-property-v2: ${passed} passed, ${failed} failed`);
