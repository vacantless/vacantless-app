import { COPILOT_STOP_GATES } from "@/lib/distribution-copilot";
import {
  buildExtensionKit,
  EXTENSION_CHANNELS,
  isExtensionChannel,
  type ExtensionPhotoInput,
} from "@/lib/extension-kit";
import { buildFillSheet, type FillSheetInput } from "@/lib/listing-fill-sheet";
import { MAX_PHOTOS } from "@/lib/listing-feed";

let pass = 0;
let fail = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}

function eq(got: unknown, want: unknown, msg: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(
      `FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
    );
  }
}

const LISTING: FillSheetInput = {
  businessName: "North Star Rentals",
  address: "506 Manning Avenue, Toronto, ON",
  rentCents: 245000,
  beds: 2,
  baths: 1,
  description: "Bright main-floor unit with updated finishes and transit nearby.",
  publicUrl: "https://app.vacantless.com/r/unit-1",
  features: {
    available_date: "2026-08-01",
    sqft: 850,
    parking: "1 driveway spot",
    laundry: "in_suite",
    air_conditioning: true,
    furnished: false,
    heat_included: true,
    hydro_included: false,
    water_included: true,
  },
  now: new Date("2026-07-20T12:00:00Z"),
};

const trackedLinks = {
  kijiji: "https://app.vacantless.com/r/unit-1?p=kijiji-post",
  facebook: "https://app.vacantless.com/r/unit-1?p=facebook-post",
};

const photos: ExtensionPhotoInput[] = Array.from(
  { length: MAX_PHOTOS + 8 },
  (_, i) => ({
    url: `https://cdn.example.com/photo-${String(i + 1).padStart(2, "0")}.jpg`,
    isCover: i === 12,
    sortOrder: i + 1,
  }),
);

const kit = buildExtensionKit({
  property: { id: "unit-1", address: LISTING.address },
  listing: LISTING,
  trackedLinks,
  photos,
  generatedAt: "2026-07-20T12:34:56.000Z",
});

eq(
  EXTENSION_CHANNELS,
  ["kijiji", "facebook"],
  "channel set is locked to kijiji + facebook",
);
ok(isExtensionChannel("kijiji"), "isExtensionChannel accepts kijiji");
ok(isExtensionChannel("facebook"), "isExtensionChannel accepts facebook");
ok(!isExtensionChannel("viewit"), "isExtensionChannel rejects viewit");
ok(!isExtensionChannel(""), "isExtensionChannel rejects blank");

eq(
  kit.property,
  { id: "unit-1", address: LISTING.address },
  "property identity preserved",
);
eq(kit.generatedAt, "2026-07-20T12:34:56.000Z", "generatedAt is caller-supplied");
eq(
  kit.channels.map((c) => c.channel.key),
  EXTENSION_CHANNELS,
  "kit channel order follows extension channels",
);

for (const channel of kit.channels) {
  const key = channel.channel.key;
  ok(channel.channel.label.length > 0, `${key}: channel label present`);
  ok(channel.channel.portalUrl.startsWith("https://"), `${key}: portal URL present`);
  ok(channel.channel.modeLabel.length > 0, `${key}: mode label present`);
  ok(channel.copy.title.length > 0, `${key}: copy title present`);
  ok(channel.copy.body.length > 0, `${key}: copy body present`);
  ok(channel.copy.body.includes(trackedLinks[key]), `${key}: copy uses tracked link`);
  eq(channel.trackedLink, trackedLinks[key], `${key}: tracked link passed through`);
  eq(
    channel.fields.map((field) => field.id),
    buildFillSheet({ ...LISTING, publicUrl: trackedLinks[key] }, key).fields.map(
      (field) => field.id,
    ),
    `${key}: fill-sheet ids pass through untouched`,
  );
  eq(
    channel.fields,
    buildFillSheet({ ...LISTING, publicUrl: trackedLinks[key] }, key).fields,
    `${key}: fill-sheet fields pass through verbatim`,
  );
  eq(
    channel.stopGates.map((gate) => gate.key),
    COPILOT_STOP_GATES,
    `${key}: all stop gates present`,
  );
  ok(
    channel.stopGates.every(
      (gate) => gate.label.length > 0 && gate.note.length > 0,
    ),
    `${key}: stop gates have labels and notes`,
  );
  ok(channel.guardrails.length > 0, `${key}: guardrails present`);
  eq(
    channel.distributeTabUrl,
    "/dashboard/properties/unit-1#distribute",
    `${key}: distribute tab deep link`,
  );
  eq(channel.photos.length, MAX_PHOTOS, `${key}: photos capped at feed max`);
  eq(channel.photos[0], "https://cdn.example.com/photo-13.jpg", `${key}: cover photo first`);
}

const deterministicAgain = buildExtensionKit({
  property: { id: "unit-1", address: LISTING.address },
  listing: LISTING,
  trackedLinks,
  photos,
  generatedAt: "2026-07-20T12:34:56.000Z",
});
eq(deterministicAgain, kit, "fixed input and generatedAt produce deterministic output");

const minimal = buildExtensionKit({
  property: { id: "minimal", address: "1 Plain Street" },
  listing: {
    address: "1 Plain Street",
    rentCents: null,
    beds: null,
    baths: null,
    description: null,
    publicUrl: null,
    features: {},
    now: new Date("2026-07-20T12:00:00Z"),
  },
  trackedLinks: {
    kijiji: "https://app.vacantless.com/r/minimal?p=k",
    facebook: "https://app.vacantless.com/r/minimal?p=f",
  },
  photos: [],
  generatedAt: "2026-07-20T12:34:56.000Z",
});
eq(minimal.channels[0]?.photos, [], "missing photos build as an empty array");
ok(
  minimal.channels.every((channel) => channel.fields.length > 0),
  "missing optional listing data still builds fields",
);

console.log(`test-extension-kit: ${pass}/${fail}`);
if (fail > 0) process.exit(1);
