// Unit tests for the pure per-channel listing readiness engine.
// Run: npx tsx scripts/test-channel-readiness.ts

import {
  CHANNEL_READINESS_CHANNELS,
  buildChannelReadiness,
  readinessByChannel,
  type ChannelReadinessInput,
} from "../lib/channel-readiness";

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

const full: ChannelReadinessInput = {
  id: "p1",
  status: "available",
  rentCents: 245000,
  beds: 3,
  baths: 1.5,
  address: "12 Donwoods Dr, Toronto ON",
  photoCount: 3,
  availabilityWindowCount: 2,
  replyToEmail: "rentals@example.com",
  description:
    "Bright three-bedroom home with a renovated kitchen, private outdoor space, parking, and easy access to transit.",
  contactPhone: "+1 416-555-0100",
  unit_type: "house",
  structure_type: "freehold",
  amenities: ["dishwasher", "gym"],
  heat_included: true,
  water_included: true,
  internet_included: true,
  parking_type: "garage",
  parking_count: 1,
};

ok("channel list has all current display channels", CHANNEL_READINESS_CHANNELS.length === 16);

const fullByChannel = readinessByChannel(full);
ok("vacantless ready", fullByChannel.vacantless_page.status === "ready");
ok("syndication ready", fullByChannel.syndication_feed.status === "ready");
ok("kijiji ready", fullByChannel.kijiji.status === "ready");
ok("facebook ready", fullByChannel.facebook_marketplace.status === "ready");
ok("rentals.ca ready", fullByChannel.rentals_ca.status === "ready");
ok("rentfaster ready", fullByChannel.rentfaster.status === "ready");
ok("zumper ready", fullByChannel.zumper.status === "ready");
ok("viewit ready", fullByChannel.viewit.status === "ready");
ok("spacelist waits for commercial fields", fullByChannel.spacelist.status === "missing_required");
ok("costar_loopnet waits for CRE or multifamily fields", fullByChannel.costar_loopnet.status === "missing_required");
ok("facebook page ready", fullByChannel.facebook_page.status === "ready");
ok("instagram ready", fullByChannel.instagram.status === "ready");
ok("whatsapp ready", fullByChannel.whatsapp.status === "ready");
ok("linkedin ready", fullByChannel.linkedin.status === "ready");
ok("snapchat ready", fullByChannel.snapchat.status === "ready");
ok("mls advisory ready", fullByChannel.mls.status === "ready");
ok("mls advisory flag", fullByChannel.mls.advisoryOnly === true);
ok("mls has no required flags", fullByChannel.mls.missingRequired.length === 0);
ok(
  "spacelist names commercial-specific gaps",
  ["Commercial use", "Available area", "Lease rate / price"].every((label) =>
    fullByChannel.spacelist.missingRequired.includes(label),
  ),
);
ok(
  "costar_loopnet names CRE and multifamily-specific gaps",
  [
    "Commercial or 5+ multifamily asset type",
    "Unit count",
    "Available area",
    "Lease rate / price",
  ].every((label) =>
    fullByChannel.costar_loopnet.missingRequired.includes(label),
  ),
);
ok("kijiji has direct portal fallback", fullByChannel.kijiji.directPortalSupported === true);
ok(
  "rentals.ca keeps portal-only choices",
  fullByChannel.rentals_ca.manualChoices.includes("Plan/add-on choice"),
);

const bare: ChannelReadinessInput = {
  ...full,
  beds: null,
  baths: null,
  photoCount: 0,
  availabilityWindowCount: 0,
  replyToEmail: null,
  description: null,
  contactPhone: null,
  unit_type: null,
  structure_type: null,
  amenities: null,
  heat_included: null,
  water_included: null,
  internet_included: null,
  parking_type: null,
  parking_count: null,
};

const bareReadiness = buildChannelReadiness(bare);
ok(
  "bare listing has required gaps on every non-MLS channel",
  bareReadiness
    .filter((entry) => entry.channel !== "mls")
    .every((entry) => entry.status === "missing_required" && entry.missingRequired.length > 0),
);
ok(
  "bare syndication names contact phone",
  readinessByChannel(bare).syndication_feed.missingRequired.includes("Contact phone"),
);
ok(
  "bare syndication names property type",
  readinessByChannel(bare).syndication_feed.missingRequired.includes("Property type"),
);

const noPhoto = readinessByChannel({ ...full, photoCount: 0 });
ok("no-photo vacantless is recommended gap", noPhoto.vacantless_page.status === "missing_recommended");
ok(
  "no-photo vacantless recommends photo",
  noPhoto.vacantless_page.missingRecommended.includes("Photo"),
);
ok(
  "no-photo syndication requires photo",
  noPhoto.syndication_feed.missingRequired.includes("Photo"),
);
ok(
  "no-photo facebook requires photo",
  noPhoto.facebook_marketplace.missingRequired.includes("Photo"),
);
ok(
  "no-photo rentals.ca requires a second photo",
  noPhoto.rentals_ca.missingRequired.includes("Second photo"),
);

const withLink = readinessByChannel({
  ...full,
  description:
    "Bright three-bedroom home with a renovated kitchen, parking, and transit access. Apply at https://example.com/listing.",
});
ok(
  "facebook blocks clickable links",
  withLink.facebook_marketplace.missingRequired.includes("No clickable links in description"),
);
ok(
  "link rule is channel-specific",
  !withLink.kijiji.missingRequired.includes("No clickable links in description"),
);
const doubleSpace = readinessByChannel({
  ...full,
  description:
    "Bright three-bedroom home with a renovated kitchen,  parking, and easy transit access.",
});
ok(
  "facebook does not treat extra spacing as a link",
  !doubleSpace.facebook_marketplace.missingRequired.includes("No clickable links in description"),
);

const missingRecommendations = readinessByChannel({
  ...full,
  amenities: null,
  heat_included: null,
  water_included: null,
  internet_included: null,
  parking_type: null,
  parking_count: null,
  parking: null,
});
ok(
  "kijiji recommends amenity set",
  missingRecommendations.kijiji.missingRecommended.includes("Amenities"),
);
ok(
  "rentfaster recommends included utilities",
  missingRecommendations.rentfaster.missingRecommended.includes("Included utilities"),
);
ok(
  "facebook recommends parking details",
  missingRecommendations.facebook_marketplace.missingRecommended.includes("Parking details"),
);
ok(
  "zumper carries direct portal sqft choice",
  readinessByChannel(full).zumper.manualChoices.includes("Size/sqft value"),
);

console.log(`channel-readiness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
