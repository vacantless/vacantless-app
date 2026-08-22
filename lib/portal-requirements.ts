// ============================================================================
// Source-owned portal requirements for the "one listing, many channels" model.
//
// This is static product intelligence, not live integration proof. It tells the
// UI/workflow which listing details each portal needs, which items remain an
// operator step (sign-in, payment, proof), and which claims are sourced vs.
// inferred. Re-check public portal docs before changing a live connector,
// auto-payment path, or provider-facing promise.
// ============================================================================

import type { PortalKey } from "./listing-distribution";

export type PortalRequirementChannelKey = Exclude<PortalKey, "other">;

export const PORTAL_REQUIREMENT_FIELD_KEYS = [
  "title",
  "address",
  "unit_number",
  "rent",
  "beds_baths",
  "photos",
  "description",
  "property_type",
  "contact_phone",
  "contact_email",
  "availability_date",
  "lease_term",
  "utilities",
  "parking",
  "amenities",
  "pets",
  "laundry",
  "air_conditioning",
  "furnished",
  "square_footage",
  "virtual_tour",
  "floorplans",
  "video",
  "account_login",
  "payment",
  "identity_verification",
  "feed_route",
  "broker_route",
  "audience",
  "post_caption",
  "tracked_link",
  "proof_url",
] as const;
export type PortalRequirementFieldKey =
  (typeof PORTAL_REQUIREMENT_FIELD_KEYS)[number];

export const PORTAL_REQUIREMENT_FIELD_LABELS: Record<
  PortalRequirementFieldKey,
  string
> = {
  title: "Title",
  address: "Address",
  unit_number: "Unit number",
  rent: "Rent",
  beds_baths: "Beds and baths",
  photos: "Photos",
  description: "Description",
  property_type: "Property type",
  contact_phone: "Contact phone",
  contact_email: "Contact email",
  availability_date: "Availability date",
  lease_term: "Lease term",
  utilities: "Utilities",
  parking: "Parking",
  amenities: "Amenities",
  pets: "Pet policy",
  laundry: "Laundry",
  air_conditioning: "Air conditioning",
  furnished: "Furnished",
  square_footage: "Square footage",
  virtual_tour: "Virtual tour",
  floorplans: "Floorplans",
  video: "Video",
  account_login: "Account sign-in",
  payment: "Site payment",
  identity_verification: "Identity verification",
  feed_route: "Feed route",
  broker_route: "Broker route",
  audience: "Audience",
  post_caption: "Post caption",
  tracked_link: "Tracked link",
  proof_url: "Live ad proof",
};

export const PORTAL_OPERATOR_FIELD_KEYS = [
  "account_login",
  "payment",
  "identity_verification",
  "feed_route",
  "broker_route",
  "audience",
  "proof_url",
] as const satisfies readonly PortalRequirementFieldKey[];

const PORTAL_OPERATOR_FIELD_KEY_SET = new Set<string>(PORTAL_OPERATOR_FIELD_KEYS);

export function isPortalOperatorField(
  key: PortalRequirementFieldKey,
): boolean {
  return PORTAL_OPERATOR_FIELD_KEY_SET.has(key);
}

export function portalRequirementFieldLabel(
  key: PortalRequirementFieldKey,
): string {
  return PORTAL_REQUIREMENT_FIELD_LABELS[key];
}

export const PORTAL_DISTRIBUTION_TIERS = [
  "included",
  "needs_tap",
  "top_up",
  "broker",
] as const;
export type PortalDistributionTier = (typeof PORTAL_DISTRIBUTION_TIERS)[number];

export const PORTAL_AUTOMATION_MODES = [
  "api_post",
  "feed_candidate",
  "posting_assist",
  "paid_self_serve",
  "broker_referral",
  "share_message",
] as const;
export type PortalAutomationMode = (typeof PORTAL_AUTOMATION_MODES)[number];

export const PORTAL_REQUIREMENT_SOURCE_LEVELS = [
  "official",
  "partner_doc",
  "source_inference",
  "operator_assertion",
] as const;
export type PortalRequirementSourceLevel =
  (typeof PORTAL_REQUIREMENT_SOURCE_LEVELS)[number];

export type PortalRequirements = {
  channel: PortalRequirementChannelKey;
  label: string;
  defaultTier: PortalDistributionTier;
  automationMode: PortalAutomationMode;
  sourceLevel: PortalRequirementSourceLevel;
  sourceRefs: readonly string[];
  verifiedOn: string | null;
  required: readonly PortalRequirementFieldKey[];
  recommended: readonly PortalRequirementFieldKey[];
  optional: readonly PortalRequirementFieldKey[];
  operatorSteps: readonly string[];
  topUps: readonly string[];
  proofRequired: boolean;
  liveProofLabel: string;
  notes: readonly string[];
};

export const PORTAL_REQUIREMENTS: readonly PortalRequirements[] = [
  {
    channel: "kijiji",
    label: "Kijiji",
    defaultTier: "needs_tap",
    automationMode: "posting_assist",
    sourceLevel: "partner_doc",
    sourceRefs: [
      "https://help.rentsync.com/ad-requirements-kijiji",
      "https://community.kijiji.ca/t/how-to-post-an-ad-on-kijiji/248",
      "https://community.kijiji.ca/t/if-you-cannot-post-kijiji-listings/251",
    ],
    verifiedOn: "2026-08-22",
    required: [
      "title",
      "address",
      "rent",
      "description",
      "property_type",
      "contact_phone",
      "account_login",
      "proof_url",
    ],
    recommended: [
      "photos",
      "beds_baths",
      "availability_date",
      "amenities",
      "utilities",
      "parking",
      "pets",
    ],
    optional: ["video", "furnished"],
    operatorSteps: [
      "Sign in to Kijiji.",
      "Review category, package, and posting location.",
      "Paste the live ad URL back into Vacantless.",
    ],
    topUps: ["Visibility package", "Top Ad"],
    proofRequired: true,
    liveProofLabel: "Kijiji public ad URL",
    notes: [
      "Rentsync marks photos recommended for Kijiji, while Kijiji troubleshooting flags no photo as a common posting problem.",
      "Links are not allowed in the listing copy; keep the tracked inquiry link outside the description where the channel flow supports it.",
    ],
  },
  {
    channel: "facebook",
    label: "Facebook Marketplace",
    defaultTier: "needs_tap",
    automationMode: "posting_assist",
    sourceLevel: "operator_assertion",
    sourceRefs: [
      "https://www.facebook.com/help/561376580709359/",
      "https://www.facebook.com/help/2193854224216494",
    ],
    verifiedOn: null,
    required: [
      "title",
      "address",
      "rent",
      "photos",
      "description",
      "property_type",
      "account_login",
      "proof_url",
    ],
    recommended: [
      "beds_baths",
      "availability_date",
      "amenities",
      "utilities",
      "parking",
      "pets",
    ],
    optional: ["video", "tracked_link"],
    operatorSteps: [
      "Use a personal Marketplace-eligible Facebook session.",
      "Review fair-housing-safe copy and photo order before posting.",
      "Save the live Marketplace item URL or proof note.",
    ],
    topUps: ["Boosted post or paid ad, only with explicit approval"],
    proofRequired: true,
    liveProofLabel: "Marketplace item URL or proof note",
    notes: [
      "Facebook Help Center pages can require login or block unauthenticated reads, so the exact rental form field list remains session-verified before connector work.",
      "Marketplace is separate from Facebook Page feed; Page posting proof does not prove Marketplace reach.",
    ],
  },
  {
    channel: "rentals_ca",
    label: "Rentals.ca",
    defaultTier: "needs_tap",
    automationMode: "feed_candidate",
    sourceLevel: "partner_doc",
    sourceRefs: [
      "https://help.rentsync.com/ad-requirements-rentals.ca-torontorentals",
      "https://rentals.ca/landlords",
    ],
    verifiedOn: "2026-08-22",
    required: [
      "address",
      "rent",
      "photos",
      "property_type",
      "account_login",
      "proof_url",
    ],
    recommended: [
      "description",
      "contact_phone",
      "contact_email",
      "beds_baths",
      "availability_date",
      "amenities",
      "utilities",
      "parking",
      "pets",
      "identity_verification",
    ],
    optional: ["video", "virtual_tour"],
    operatorSteps: [
      "Sign in or confirm the feed/account route.",
      "Review lead contact and plan/add-on choice.",
      "Wait for instant publish if verified, otherwise review can take up to one business day.",
    ],
    topUps: ["Promoted listing", "Featured listing"],
    proofRequired: true,
    liveProofLabel: "Rentals.ca public listing URL",
    notes: [
      "Rentals.ca says the first three listings are free, with paid Promoted and Featured upgrades.",
      "Rentsync marks description and phone as recommended, not hard required, but Vacantless keeps them in the packet to improve lead handling.",
    ],
  },
  {
    channel: "rentfaster",
    label: "RentFaster.ca",
    defaultTier: "top_up",
    automationMode: "paid_self_serve",
    sourceLevel: "official",
    sourceRefs: [
      "https://www.rentfaster.ca/faq/",
      "https://help.rentsync.com/ad-requirements-rentfaster",
    ],
    verifiedOn: "2026-08-22",
    required: [
      "address",
      "rent",
      "beds_baths",
      "photos",
      "description",
      "property_type",
      "contact_phone",
      "account_login",
      "payment",
      "proof_url",
    ],
    recommended: [
      "contact_email",
      "availability_date",
      "lease_term",
      "amenities",
      "utilities",
      "parking",
      "pets",
      "laundry",
      "air_conditioning",
      "furnished",
      "square_footage",
    ],
    optional: ["video", "virtual_tour", "floorplans", "identity_verification"],
    operatorSteps: [
      "Sign in or create a RentFaster account.",
      "Choose single-unit or multi-unit package.",
      "Submit required fields, complete payment, then upload or manage photos.",
      "New-user listings can require admin review before going live.",
    ],
    topUps: ["Zumper Network add-on", "Promotions", "Multi-unit package"],
    proofRequired: true,
    liveProofLabel: "RentFaster public listing URL",
    notes: [
      "RentFaster says photos can be uploaded after the property-details form is submitted, but the partner requirements mark photos as required for syndication.",
      "RentFaster single-unit listings are commonly 60 days; renewals/reactivations can require payment.",
    ],
  },
  {
    channel: "zumper",
    label: "Zumper + PadMapper",
    defaultTier: "needs_tap",
    automationMode: "feed_candidate",
    sourceLevel: "official",
    sourceRefs: [
      "https://help.zumper.com/hc/en-us/sections/360007943393-Listing-a-Property",
      "https://help.zumper.com/hc/en-us/articles/4405465974043-My-feed-is-set-up-where-are-my-properties",
      "https://help.rentsync.com/ad-requirements-zumper-padmapper",
    ],
    verifiedOn: "2026-08-22",
    required: [
      "address",
      "rent",
      "beds_baths",
      "photos",
      "description",
      "property_type",
      "contact_phone",
      "account_login",
      "proof_url",
    ],
    recommended: [
      "contact_email",
      "availability_date",
      "lease_term",
      "amenities",
      "utilities",
      "parking",
      "pets",
      "square_footage",
    ],
    optional: ["video", "virtual_tour", "floorplans"],
    operatorSteps: [
      "Sign in or confirm an accepted feed route.",
      "Publish on Zumper or wait for feed display.",
      "Confirm the public listing URL after it appears.",
    ],
    topUps: ["Premium listing plan", "Promoted placement", "Verified badge"],
    proofRequired: true,
    liveProofLabel: "Zumper or PadMapper public listing URL",
    notes: [
      "Zumper says public listings should appear in search results within two to three hours after publishing.",
      "Rentsync lists Zumper and PadMapper as paid, with photos, descriptions, property type, phone number, and price required.",
    ],
  },
  {
    channel: "viewit",
    label: "Viewit.ca",
    defaultTier: "top_up",
    automationMode: "paid_self_serve",
    sourceLevel: "source_inference",
    sourceRefs: [
      "https://www.viewit.ca/FAQ_Landlord",
      "https://listingseditor.viewit.ca/Editor_help",
    ],
    verifiedOn: "2026-08-22",
    required: [
      "address",
      "rent",
      "beds_baths",
      "photos",
      "description",
      "property_type",
      "contact_phone",
      "contact_email",
      "payment",
      "proof_url",
    ],
    recommended: ["availability_date", "amenities", "utilities", "parking", "pets"],
    optional: ["video", "virtual_tour"],
    operatorSteps: [
      "Add or reactivate the rental on Viewit.ca.",
      "Approve the Viewit activation fee.",
      "Use the activation email edit link to adjust text, photos, video, or deactivation.",
    ],
    topUps: ["Featured vacancy", "Shown first to tenants"],
    proofRequired: true,
    liveProofLabel: "Viewit ViT URL",
    notes: [
      "Viewit publishes via a paid activation and edit-link workflow, not a proven Vacantless account integration.",
      "Exact required field names should be rechecked in the authenticated Viewit add-rental flow before automation work.",
    ],
  },
  {
    channel: "realtor_ca",
    label: "Realtor.ca",
    defaultTier: "broker",
    automationMode: "broker_referral",
    sourceLevel: "source_inference",
    sourceRefs: ["Vacantless Realtor.ca broker/DDF guardrails"],
    verifiedOn: null,
    required: [
      "address",
      "rent",
      "beds_baths",
      "photos",
      "description",
      "property_type",
      "contact_phone",
      "broker_route",
      "proof_url",
    ],
    recommended: [
      "availability_date",
      "lease_term",
      "amenities",
      "utilities",
      "parking",
      "pets",
      "square_footage",
    ],
    optional: ["video", "virtual_tour", "floorplans"],
    operatorSteps: [
      "Send the field sheet to a licensed broker or MLS route.",
      "Do not mark live until the real Realtor.ca listing URL exists.",
    ],
    topUps: [],
    proofRequired: true,
    liveProofLabel: "Realtor.ca public listing URL",
    notes: [
      "Realtor.ca is not a self-serve landlord portal in this product; Vacantless tracks the broker route only.",
    ],
  },
  {
    channel: "facebook_feed",
    label: "Facebook Page feed",
    defaultTier: "included",
    automationMode: "api_post",
    sourceLevel: "source_inference",
    sourceRefs: ["Vacantless Facebook Page Graph posting implementation"],
    verifiedOn: null,
    required: ["photos", "post_caption", "tracked_link", "account_login", "proof_url"],
    recommended: ["address", "rent", "beds_baths", "availability_date"],
    optional: ["video"],
    operatorSteps: [
      "Connect and authorize the Facebook Page.",
      "Approve the prepared organic Page post.",
    ],
    topUps: ["Paid ads, only with explicit approval"],
    proofRequired: true,
    liveProofLabel: "Facebook Page post permalink",
    notes: [
      "Facebook Page feed is not Facebook Marketplace and does not provide Marketplace insight or reach proof.",
    ],
  },
  {
    channel: "instagram",
    label: "Instagram",
    defaultTier: "included",
    automationMode: "api_post",
    sourceLevel: "source_inference",
    sourceRefs: ["Vacantless Instagram Business posting implementation"],
    verifiedOn: null,
    required: ["photos", "post_caption", "tracked_link", "account_login", "proof_url"],
    recommended: ["address", "rent", "beds_baths", "availability_date"],
    optional: ["video"],
    operatorSteps: [
      "Connect an Instagram Business account.",
      "Approve image and caption before posting.",
    ],
    topUps: ["Paid ads, only with explicit approval"],
    proofRequired: true,
    liveProofLabel: "Instagram media permalink",
    notes: [
      "Stories, Reels, carousels, and ads are separate future surfaces from the current single-post path.",
    ],
  },
  {
    channel: "whatsapp",
    label: "WhatsApp",
    defaultTier: "needs_tap",
    automationMode: "share_message",
    sourceLevel: "source_inference",
    sourceRefs: ["Vacantless share-message channel model"],
    verifiedOn: null,
    required: ["post_caption", "tracked_link", "audience", "proof_url"],
    recommended: ["photos", "address", "rent", "beds_baths", "availability_date"],
    optional: ["video"],
    operatorSteps: [
      "Choose the WhatsApp audience or broadcast list.",
      "Send the prepared share message.",
      "Save proof note or link.",
    ],
    topUps: [],
    proofRequired: true,
    liveProofLabel: "WhatsApp proof note",
    notes: [
      "WhatsApp is a share lane, not a public listing portal; lead attribution depends on the tracked link being used.",
    ],
  },
  {
    channel: "linkedin",
    label: "LinkedIn",
    defaultTier: "needs_tap",
    automationMode: "share_message",
    sourceLevel: "source_inference",
    sourceRefs: ["Vacantless share-message channel model"],
    verifiedOn: null,
    required: ["post_caption", "tracked_link", "account_login", "proof_url"],
    recommended: ["photos", "address", "rent", "beds_baths", "availability_date"],
    optional: ["video"],
    operatorSteps: [
      "Sign in to the intended LinkedIn profile or Page.",
      "Post the prepared caption and tracked link.",
      "Save the post URL as proof.",
    ],
    topUps: ["Sponsored post, only with explicit approval"],
    proofRequired: true,
    liveProofLabel: "LinkedIn post URL",
    notes: [
      "LinkedIn is currently a planned/manual share lane, not a connected Vacantless posting integration.",
    ],
  },
  {
    channel: "snapchat",
    label: "Snapchat",
    defaultTier: "needs_tap",
    automationMode: "share_message",
    sourceLevel: "source_inference",
    sourceRefs: ["Vacantless share-message channel model"],
    verifiedOn: null,
    required: ["post_caption", "tracked_link", "account_login", "proof_url"],
    recommended: ["photos", "video", "address", "rent", "beds_baths"],
    optional: [],
    operatorSteps: [
      "Sign in to the intended Snapchat account.",
      "Post the prepared story or message.",
      "Save proof note or link.",
    ],
    topUps: ["Paid ad, only with explicit approval"],
    proofRequired: true,
    liveProofLabel: "Snapchat proof note",
    notes: [
      "Snapchat is currently a planned/manual share lane, not a connected Vacantless posting integration.",
    ],
  },
] as const;

const PORTAL_REQUIREMENTS_BY_CHANNEL = new Map<
  PortalRequirementChannelKey,
  PortalRequirements
>(PORTAL_REQUIREMENTS.map((row) => [row.channel, row]));

function unique<T extends string>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

function requirementRowsFor(
  channels: readonly (PortalRequirementChannelKey | string)[],
): PortalRequirements[] {
  return channels
    .map((channel) =>
      PORTAL_REQUIREMENTS_BY_CHANNEL.get(channel as PortalRequirementChannelKey),
    )
    .filter((row): row is PortalRequirements => Boolean(row));
}

export function portalRequirementsFor(
  channel: PortalRequirementChannelKey | PortalKey | string | null | undefined,
): PortalRequirements | null {
  if (!channel || channel === "other") return null;
  return (
    PORTAL_REQUIREMENTS_BY_CHANNEL.get(channel as PortalRequirementChannelKey) ??
    null
  );
}

export function requiredFieldsFor(
  channel: PortalRequirementChannelKey | PortalKey | string | null | undefined,
): PortalRequirementFieldKey[] {
  return [...(portalRequirementsFor(channel)?.required ?? [])];
}

export function recommendedFieldsFor(
  channel: PortalRequirementChannelKey | PortalKey | string | null | undefined,
): PortalRequirementFieldKey[] {
  return [...(portalRequirementsFor(channel)?.recommended ?? [])];
}

export type OneListingPacketRequirements = {
  channels: PortalRequirementChannelKey[];
  listingFields: PortalRequirementFieldKey[];
  operatorFields: PortalRequirementFieldKey[];
  requiredListingFields: PortalRequirementFieldKey[];
  recommendedListingFields: PortalRequirementFieldKey[];
  optionalListingFields: PortalRequirementFieldKey[];
  proofRequiredChannels: PortalRequirementChannelKey[];
  topUps: string[];
  operatorSteps: string[];
  sourceLevels: PortalRequirementSourceLevel[];
};

export function buildOneListingPacketRequirements(
  channels: readonly PortalRequirementChannelKey[] = PORTAL_REQUIREMENTS.map(
    (row) => row.channel,
  ),
): OneListingPacketRequirements {
  const rows = requirementRowsFor(channels);
  const allRequired = unique(rows.flatMap((row) => row.required));
  const allRecommended = unique(rows.flatMap((row) => row.recommended));
  const allOptional = unique(rows.flatMap((row) => row.optional));
  const operatorFields = unique(
    [...allRequired, ...allRecommended, ...allOptional].filter(
      (field) => isPortalOperatorField(field),
    ),
  );
  const requiredListingFields = allRequired.filter(
    (field) => !isPortalOperatorField(field),
  );
  const recommendedListingFields = allRecommended.filter(
    (field) => !isPortalOperatorField(field),
  );
  const optionalListingFields = allOptional.filter(
    (field) => !isPortalOperatorField(field),
  );

  return {
    channels: rows.map((row) => row.channel),
    listingFields: unique([
      ...requiredListingFields,
      ...recommendedListingFields,
      ...optionalListingFields,
    ]),
    operatorFields,
    requiredListingFields,
    recommendedListingFields,
    optionalListingFields,
    proofRequiredChannels: rows
      .filter((row) => row.proofRequired)
      .map((row) => row.channel),
    topUps: unique(rows.flatMap((row) => row.topUps)),
    operatorSteps: unique(rows.flatMap((row) => row.operatorSteps)),
    sourceLevels: unique(rows.map((row) => row.sourceLevel)),
  };
}

