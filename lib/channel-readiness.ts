// Pure per-channel listing readiness. No DB / env / IO.
// Lane A establishes the channel contract; Lane B can surface it in the UI.

import {
  MIN_DESCRIPTION_CHARS,
  clampDescription,
  listingFeedReadiness,
  stripLinks,
  type FeedListingInput,
} from "./listing-feed";
import {
  buildUtilitiesIncluded,
  feedPropertyType,
  formatParking,
  isStructureType,
  isUnitType,
  normalizeAmenities,
  type UnitFeatures,
} from "./property-features";
import { buildShareReadiness, type ShareReadinessInput } from "./share-readiness";

export const CHANNEL_READINESS_CHANNELS = [
  "vacantless_page",
  "syndication_feed",
  "kijiji",
  "facebook_marketplace",
  "rentals_ca",
  "rentfaster",
  "zumper",
  "viewit",
  "facebook_page",
  "instagram",
  "whatsapp",
  "linkedin",
  "snapchat",
  "mls",
] as const;
export type ChannelReadinessChannel = (typeof CHANNEL_READINESS_CHANNELS)[number];

export type ChannelReadinessStatus =
  | "ready"
  | "missing_recommended"
  | "missing_required";

export type ChannelReadiness = {
  channel: ChannelReadinessChannel;
  label: string;
  status: ChannelReadinessStatus;
  missingRequired: string[];
  missingRecommended: string[];
  manualChoices: string[];
  advancedOptions: string[];
  advisoryOnly?: boolean;
  directPortalSupported?: boolean;
};

export type ChannelReadinessInput = ShareReadinessInput &
  UnitFeatures & {
    id?: string | null;
    rent_cents?: number | null;
    description?: string | null;
    photos?: string[] | null;
    contactPhone?: string | null;
    contact_phone?: string | null;
  };

const CHANNEL_LABELS: Record<ChannelReadinessChannel, string> = {
  vacantless_page: "Vacantless public page",
  syndication_feed: "Syndication feed",
  kijiji: "Kijiji",
  facebook_marketplace: "Facebook Marketplace",
  rentals_ca: "Rentals.ca",
  rentfaster: "RentFaster",
  zumper: "Zumper + PadMapper",
  viewit: "Viewit.ca",
  facebook_page: "Facebook Page feed",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  snapchat: "Snapchat",
  mls: "MLS advisory",
};

const SHARE_LABELS: Record<string, string> = {
  live: "Live listing",
  address: "Address",
  rent: "Rent",
  beds_baths: "Beds and baths",
  photos: "Photo",
  viewing_times: "Viewing availability",
  reply_to: "Reply-to email",
};

const FEED_LABELS: Record<string, string> = {
  price: "Rent",
  photo: "Photo",
  description: "Description",
  description_short: `Description (${MIN_DESCRIPTION_CHARS}+ characters)`,
  address: "Address",
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function effectivePhotoCount(input: ChannelReadinessInput): number {
  if (Array.isArray(input.photos)) {
    return input.photos.filter((photo) => hasText(photo)).length;
  }
  return Math.max(0, input.photoCount);
}

function syntheticPhotos(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `readiness-photo-${i + 1}`);
}

function contactPhone(input: ChannelReadinessInput): string | null {
  return input.contactPhone ?? input.contact_phone ?? null;
}

function rentCents(input: ChannelReadinessInput): number | null {
  return input.rent_cents ?? input.rentCents ?? null;
}

function addMissing(out: string[], labels: ReadonlyArray<string>) {
  for (const label of labels) {
    if (!out.includes(label)) out.push(label);
  }
}

function shareMissing(
  input: ChannelReadinessInput,
  required: boolean,
): string[] {
  const readiness = buildShareReadiness({
    status: input.status,
    rentCents: rentCents(input),
    beds: input.beds,
    baths: input.baths,
    address: input.address,
    photoCount: effectivePhotoCount(input),
    availabilityWindowCount: input.availabilityWindowCount,
    replyToEmail: input.replyToEmail,
  });
  return readiness.checks
    .filter((check) => check.required === required && !check.ok)
    .map((check) => SHARE_LABELS[check.key] ?? check.label);
}

function feedMissing(input: ChannelReadinessInput): string[] {
  const count = effectivePhotoCount(input);
  const listing: FeedListingInput = {
    ...input,
    id: input.id ?? "readiness",
    rent_cents: rentCents(input),
    address: input.address,
    beds: input.beds,
    baths: input.baths,
    description: input.description ?? null,
    photos: Array.isArray(input.photos) ? input.photos : syntheticPhotos(count),
  };
  return listingFeedReadiness(listing).missing.map(
    (missing) => FEED_LABELS[missing] ?? missing,
  );
}

function hasPropertyTypeSignal(input: ChannelReadinessInput): boolean {
  const unit =
    typeof input.unit_type === "string"
      ? input.unit_type.trim().toLowerCase().replace(/_/g, "-")
      : "";
  const structure =
    typeof input.structure_type === "string" ? input.structure_type.trim() : "";
  const derivedType = feedPropertyType(unit, structure);
  return (
    derivedType !== "apartment" ||
    isUnitType(unit) ||
    unit === "room" ||
    unit === "loft" ||
    isStructureType(structure)
  );
}

function hasClickableLink(description: string | null | undefined): boolean {
  const value = typeof description === "string" ? description.trim() : "";
  if (!value) return false;
  return (
    /https?:\/\/[^\s]+|\bwww\.[^\s]+/i.test(value) &&
    stripLinks(value).trim() !== value
  );
}

function hasAmenitySet(input: ChannelReadinessInput): boolean {
  return normalizeAmenities(input.amenities).length > 0;
}

function hasUtilitySet(input: ChannelReadinessInput): boolean {
  return buildUtilitiesIncluded(input).length > 0;
}

function hasParking(input: ChannelReadinessInput): boolean {
  return formatParking(input.parking_type, input.parking_count, input.parking) != null;
}

function hasDescription(input: ChannelReadinessInput): boolean {
  const desc = clampDescription(input.description);
  return desc != null && desc.length >= MIN_DESCRIPTION_CHARS;
}

function result(
  channel: ChannelReadinessChannel,
  missingRequired: string[],
  missingRecommended: string[] = [],
  opts: {
    manualChoices?: string[];
    advancedOptions?: string[];
    advisoryOnly?: boolean;
    directPortalSupported?: boolean;
  } = {},
): ChannelReadiness {
  const status: ChannelReadinessStatus =
    missingRequired.length > 0
      ? "missing_required"
      : missingRecommended.length > 0
        ? "missing_recommended"
        : "ready";
  return {
    channel,
    label: CHANNEL_LABELS[channel],
    status,
    missingRequired,
    missingRecommended,
    manualChoices: opts.manualChoices ?? [],
    advancedOptions: opts.advancedOptions ?? [],
    ...(opts.advisoryOnly ? { advisoryOnly: true } : {}),
    ...(opts.directPortalSupported ? { directPortalSupported: true } : {}),
  };
}

function classifiedsRecommended(input: ChannelReadinessInput): string[] {
  const missing: string[] = [];
  if (!hasAmenitySet(input)) missing.push("Amenities");
  if (!hasUtilitySet(input)) missing.push("Included utilities");
  if (!hasParking(input)) missing.push("Parking details");
  return missing;
}

function commonPortalRequired(input: ChannelReadinessInput): string[] {
  const missing: string[] = [];
  addMissing(missing, shareMissing(input, true));
  if (effectivePhotoCount(input) === 0) missing.push("Photo");
  if (!hasDescription(input)) {
    missing.push(`Description (${MIN_DESCRIPTION_CHARS}+ characters)`);
  }
  return missing;
}

function directPortalChoices(...choices: string[]): {
  manualChoices: string[];
  directPortalSupported: true;
} {
  return { manualChoices: choices, directPortalSupported: true };
}

export function buildChannelReadiness(
  input: ChannelReadinessInput,
): ChannelReadiness[] {
  const shareRequired = shareMissing(input, true);
  const shareRecommended = shareMissing(input, false);
  const feedRequired = feedMissing(input);

  const out: ChannelReadiness[] = [];

  out.push(result("vacantless_page", shareRequired, shareRecommended));

  const syndicationRequired: string[] = [];
  addMissing(syndicationRequired, shareRequired);
  addMissing(syndicationRequired, feedRequired);
  if (!hasText(contactPhone(input))) syndicationRequired.push("Contact phone");
  if (!hasPropertyTypeSignal(input)) syndicationRequired.push("Property type");
  out.push(
    result("syndication_feed", syndicationRequired, [], {
      advancedOptions: ["Feed partner mapping", "Provider acceptance"],
    }),
  );

  out.push(
    result("kijiji", commonPortalRequired(input), classifiedsRecommended(input), {
      ...directPortalChoices(
        "Category, location, and postal code",
        "Package and cart review",
        "Live ad URL proof",
      ),
      advancedOptions: ["Paid promotion", "Refresh/repost timing"],
    }),
  );

  const facebookRequired: string[] = [];
  addMissing(facebookRequired, shareRequired);
  if (effectivePhotoCount(input) === 0) facebookRequired.push("Photo");
  if (hasClickableLink(input.description)) {
    facebookRequired.push("No clickable links in description");
  }
  const facebookRecommended = hasDescription(input)
    ? classifiedsRecommended(input)
    : [`Description (${MIN_DESCRIPTION_CHARS}+ characters)`, ...classifiedsRecommended(input)];
  out.push(
    result("facebook_marketplace", facebookRequired, facebookRecommended, {
      ...directPortalChoices(
        "Personal-profile posting",
        "Unique photo and copy variation",
        "Reply or QR-code pattern",
      ),
    }),
  );

  const rentalsRequired = commonPortalRequired(input);
  if (effectivePhotoCount(input) < 2) rentalsRequired.push("Second photo");
  if (!hasText(contactPhone(input))) rentalsRequired.push("Lead contact phone");
  out.push(
    result("rentals_ca", rentalsRequired, classifiedsRecommended(input), {
      ...directPortalChoices(
        "Property type and address autocomplete",
        "Lead contact",
        "Plan/add-on choice",
        "Enable after posting",
      ),
      advancedOptions: ["Parking fee/details", "Open house", "Rent special"],
    }),
  );

  out.push(
    result("rentfaster", commonPortalRequired(input), classifiedsRecommended(input), {
      ...directPortalChoices(
        "Single-unit package",
        "Add-on/payment review",
        "Public ad proof URL",
      ),
      advancedOptions: ["Paid promotion", "Reactivation path"],
    }),
  );

  out.push(
    result("zumper", commonPortalRequired(input), classifiedsRecommended(input), {
      ...directPortalChoices(
        "Address autocomplete",
        "Size/sqft value",
        "Boost choice",
      ),
      advancedOptions: ["PadMapper exposure", "Rent override"],
    }),
  );

  out.push(
    result("viewit", commonPortalRequired(input), classifiedsRecommended(input), {
      ...directPortalChoices("Payment review", "Public ad proof URL"),
      advancedOptions: ["Paid listing package"],
    }),
  );

  const socialRequired: string[] = [];
  addMissing(socialRequired, shareRequired);
  if (effectivePhotoCount(input) === 0) socialRequired.push("Photo");
  out.push(
    result("facebook_page", socialRequired, [], {
      manualChoices: ["Page connection and approval"],
      advancedOptions: ["Organic post copy", "Tracked link"],
    }),
  );
  out.push(
    result("instagram", socialRequired, [], {
      manualChoices: ["Business account connection", "Image choice"],
      advancedOptions: ["Caption", "Tracked link"],
    }),
  );

  const shareOnlyRequired: string[] = [];
  addMissing(shareOnlyRequired, shareRequired);
  for (const channel of ["whatsapp", "linkedin", "snapchat"] as const) {
    out.push(
      result(channel, shareOnlyRequired, [], {
        ...directPortalChoices("Share message", "Proof link or note"),
        advancedOptions: ["Audience/list choice"],
      }),
    );
  }

  out.push(
    result("mls", [], [], {
      advisoryOnly: true,
      manualChoices: ["Broker/MLS route"],
      advancedOptions: ["Agent field sheet", "DDF/Realtor.ca proof"],
    }),
  );

  return out;
}

export function readinessByChannel(
  input: ChannelReadinessInput,
): Record<ChannelReadinessChannel, ChannelReadiness> {
  return Object.fromEntries(
    buildChannelReadiness(input).map((entry) => [entry.channel, entry]),
  ) as Record<ChannelReadinessChannel, ChannelReadiness>;
}
