// Unit tests for the one-listing packet readiness reducer.
// Run: npx tsx scripts/test-listing-packet-readiness.ts

import {
  buildListingPacketReadiness,
  isGeneratedPacketField,
  isListingPacketField,
  type ListingPacketFieldFacts,
} from "../lib/listing-packet-readiness";

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

const strongPortalFacts: ListingPacketFieldFacts = {
  title: true,
  address: true,
  rent: true,
  beds_baths: true,
  photos: true,
  description: true,
  property_type: true,
  contact_phone: true,
  contact_email: true,
  availability_date: true,
  lease_term: true,
  utilities: true,
  parking: true,
  amenities: true,
  pets: true,
  laundry: true,
  air_conditioning: true,
  furnished: true,
  square_footage: true,
  virtual_tour: true,
  floorplans: true,
  video: true,
};

ok("rent is a listing packet field", isListingPacketField("rent"));
ok("payment is not a listing packet field", !isListingPacketField("payment"));
ok("proof URL is not a listing packet field", !isListingPacketField("proof_url"));
ok("tracked link is generated", isGeneratedPacketField("tracked_link"));
ok("post caption is generated", isGeneratedPacketField("post_caption"));
ok("post caption is not a listing packet field", !isListingPacketField("post_caption"));

const readyPortals = buildListingPacketReadiness({
  channels: ["kijiji", "rentals_ca", "rentfaster", "zumper", "viewit"],
  fieldFacts: strongPortalFacts,
});
ok("five selected portal rows", readyPortals.channelCount === 5);
ok("all selected portals ready", readyPortals.readyChannelCount === 5);
ok("ready portal packet has no missing required facts", readyPortals.missingRequired.length === 0);
ok("portal packet still knows operator fields exist", readyPortals.operatorFieldCount >= 2);
ok("portal packet does not treat payment as missing listing fact", !readyPortals.missingRequired.some((m) => m.field === "payment"));

const defaultLaunchPacket = buildListingPacketReadiness({
  channels: ["facebook", "kijiji"],
  fieldFacts: strongPortalFacts,
});
ok("default launch packet covers Facebook and Kijiji only", defaultLaunchPacket.channelCount === 2);
ok("default launch packet is ready with residential facts", defaultLaunchPacket.readyChannelCount === 2);
ok(
  "default launch packet ignores commercial-only listing fields",
  !defaultLaunchPacket.missingRequired.some((m) =>
    ["available_area", "lease_rate", "transaction_type"].includes(m.field),
  ),
);

const commercialLaunchPacket = buildListingPacketReadiness({
  channels: ["spacelist", "costar_loopnet"],
  fieldFacts: strongPortalFacts,
});
ok(
  "commercial launch packet still requires commercial listing fields",
  commercialLaunchPacket.missingRequired.some((m) => m.field === "available_area") &&
    commercialLaunchPacket.missingRequired.some((m) => m.field === "lease_rate"),
);

const missingPhotos = buildListingPacketReadiness({
  channels: ["rentals_ca", "rentfaster", "zumper", "viewit"],
  fieldFacts: { ...strongPortalFacts, photos: false },
});
ok("missing photos blocks four selected portals", missingPhotos.readyChannelCount === 0);
ok("photos is top missing required fact", missingPhotos.missingRequired[0]?.field === "photos");
ok("photos lists four blocked channels", missingPhotos.missingRequired[0]?.channelCount === 4);

const missingContact = buildListingPacketReadiness({
  channels: ["rentals_ca", "rentfaster", "zumper", "viewit"],
  fieldFacts: { ...strongPortalFacts, contact_phone: false },
});
ok("Rentals.ca stays ready without phone because it is recommended there", missingContact.readyChannelCount === 1);
ok("contact phone blocks three paid/feed portals", missingContact.missingRequired[0]?.field === "contact_phone");
ok("contact phone appears recommended somewhere too", missingContact.missingRecommended.some((m) => m.field === "contact_phone"));

const socialPacket = buildListingPacketReadiness({
  channels: ["facebook_feed", "instagram", "linkedin", "whatsapp", "snapchat"],
  fieldFacts: { photos: true, address: true, rent: true, beds_baths: true },
});
ok("generated social caption/link do not block listing packet", socialPacket.readyChannelCount === 5);
ok("social packet counts generated fields separately", socialPacket.generatedFieldCount === 2);
ok("social packet keeps account/audience/proof out of missing facts", socialPacket.missingRequired.length === 0);

const weakPacket = buildListingPacketReadiness({
  channels: ["kijiji", "rentals_ca", "rentfaster"],
  fieldFacts: {
    address: true,
    rent: true,
  },
});
ok("weak packet has missing required facts", weakPacket.missingRequired.length > 0);
ok("weak packet missing facts are sorted by channel count", weakPacket.missingRequired[0]!.channelCount >= weakPacket.missingRequired.at(-1)!.channelCount);
ok("description blocks Kijiji and RentFaster", weakPacket.missingRequired.some((m) => m.field === "description" && m.channelCount === 2));
ok("beds/baths only blocks RentFaster in selected trio", weakPacket.missingRequired.some((m) => m.field === "beds_baths" && m.channelCount === 1));

console.log(`listing-packet-readiness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
