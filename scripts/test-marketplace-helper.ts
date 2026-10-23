// Unit tests for the Marketplace helper kit (S735).
// Run: npx tsx scripts/test-marketplace-helper.ts
import assert from "node:assert/strict";
import {
  marketplaceAirConditioning,
  marketplaceHeating,
  marketplaceLaundry,
  marketplaceParking,
  buildMarketplaceHelperKit,
  buildMarketplaceTitle,
  helperVersionOk,
  isHelperPong,
  marketplacePropertyType,
  streetOf,
} from "../lib/marketplace-helper";

assert.equal(marketplacePropertyType("condo"), "apartment");
assert.equal(marketplacePropertyType("basement-apartment"), "apartment");
assert.equal(marketplacePropertyType("duplex-triplex"), "house");
assert.equal(marketplacePropertyType("townhouse"), "townhouse");
assert.equal(marketplacePropertyType(null), "apartment");
assert.equal(marketplacePropertyType("castle"), "apartment");

assert.equal(streetOf("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4"), "833 Pillette Rd");
assert.equal(streetOf(null), "");

assert.equal(
  buildMarketplaceTitle({ beds: 2, unitType: "apartment", address: "833 Pillette Rd, Unit 3, Windsor, ON" }),
  "2 bedroom apartment for rent, 833 Pillette Rd",
);
assert.equal(buildMarketplaceTitle({ beds: 0, unitType: "condo", address: null }), "Bachelor apartment for rent");
assert.equal(buildMarketplaceTitle({ beds: null, unitType: "house", address: "1 Main St" }), "House for rent, 1 Main St");
assert.ok(buildMarketplaceTitle({ beds: 3, unitType: "house", address: "x".repeat(200) }).length <= 100);

const kit = buildMarketplaceHelperKit({
  propertyId: "p1",
  address: " 833 Pillette Rd, Unit 3, Windsor, ON ",
  rentCents: 127500,
  beds: 2,
  baths: "1.5",
  sqft: 850,
  unitType: "apartment",
  description: "Bright two bedroom.\nBook a viewing: https://app.vacantless.com/r/p1 ",
  availableDate: "2026-11-01",
  photoUrls: ["https://x/1.jpg", null, "ftp://no", ...Array.from({ length: 12 }, (_, i) => `https://x/${i + 2}.jpg`)],
  publicUrl: "https://app.vacantless.com/r/p1",
});
assert.equal(kit.v, 1);
assert.equal(kit.priceDollars, 1275);
assert.equal(kit.baths, 1.5);
assert.equal(kit.sqft, 850);
assert.equal(kit.address, "833 Pillette Rd, Unit 3, Windsor, ON");
assert.equal(kit.photoUrls.length, 10);
assert.equal(kit.photoUrls[0], "https://x/1.jpg");
assert.equal(kit.createUrl, "https://www.facebook.com/marketplace/create/rental");
assert.equal(kit.description.endsWith("/r/p1"), true);

// Dropdown words, exactly as Marketplace spells them.
assert.equal(marketplaceLaundry("in_suite"), "In-unit laundry");
assert.equal(marketplaceLaundry("shared"), "Laundry in building");
assert.equal(marketplaceLaundry(null), null);
assert.equal(marketplaceParking("garage", null, null), "Garage parking");
assert.equal(marketplaceParking("outdoor", null, null), "Off-street parking");
assert.equal(marketplaceParking(null, 1, null), "Parking available");
assert.equal(marketplaceParking(null, null, "1 covered carport"), "Parking available");
assert.equal(marketplaceParking(null, null, "No parking"), "None");
assert.equal(marketplaceParking(null, null, ""), null);
assert.equal(marketplaceAirConditioning(true, "central"), "Central AC");
assert.equal(marketplaceAirConditioning(true, null), "AC available");
assert.equal(marketplaceAirConditioning(false, null), "None");
assert.equal(marketplaceAirConditioning(null, null), null);
assert.equal(marketplaceHeating("forced_air"), "Central heating");
assert.equal(marketplaceHeating("baseboard"), "Electric heating");
assert.equal(marketplaceHeating("boiler"), "Radiator heating");
assert.equal(marketplaceHeating(null), null);
assert.equal(kit.laundry, null);

assert.equal(helperVersionOk("1.0.0"), true);
assert.equal(helperVersionOk("1.2.0"), true);
assert.equal(helperVersionOk("0.3.0"), false);
assert.equal(helperVersionOk(undefined), false);

assert.equal(isHelperPong({ source: "vacantless-helper", type: "pong", version: "1.0.0" }), true);
assert.equal(isHelperPong({ source: "vacantless-extension", type: "pong", version: "0.3.0" }), false);
assert.equal(isHelperPong(null), false);

console.log("test-marketplace-helper: all passed");
