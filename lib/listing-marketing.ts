// ============================================================================
// Pure helpers for the listing-marketing KIT (S388, Tier A).
// No DOM / env / IO — fully unit-testable (see scripts/test-listing-marketing.ts).
//
// The kit is the paid "promote this listing" PACKAGE: it does NOT generate copy
// (lib/listing-copy already does that) and it does NOT run or pay for any ad
// (that is the later Tier B done-for-you boost). It ASSEMBLES what the landlord
// needs to promote an active rental themselves: the per-channel wording bundled
// into one copy-everything blob, the public landing link, and a "where to post"
// checklist. The QR image is generated separately (lib/qr-svg, impure) and the
// gate lives in lib/billing (canUseListingMarketing). House rules carry over
// from listing-copy: hyphens not em dashes; never fabricate reach claims.
// ============================================================================

// One channel's ready-to-paste copy, shaped exactly like the ListingCopyCard
// tabs the property page already builds (lib/listing-copy -> buildAllListingCopy).
export type KitChannel = {
  key: string;
  label: string;
  title: string;
  body: string;
};

export type MarketingKit = {
  // The public /r landing link the QR encodes and every channel points at, or
  // null when the rental is not Live (Draft / off market) so the caller can
  // soften the framing instead of shipping a dead link.
  landingUrl: string | null;
  channels: KitChannel[];
  // One plain-text blob bundling the landing link + every channel's wording, for
  // a single "copy everything" action.
  combinedText: string;
  // Ordered list of human labels for the "where to post" checklist (the generic
  // master copy is excluded — it is the source, not a destination).
  postChecklist: string[];
};

// The portal-agnostic master copy key (mirrors lib/listing-copy COPY_PORTAL_KEYS
// "generic"). It is the source wording, never a place you post, so it is kept
// out of the "where to post" checklist.
const MASTER_CHANNEL_KEY = "generic";

// The destinations a landlord actually posts to. Built from the channels passed
// in (so it stays in sync with whatever listing-copy produced) minus the master.
export function postChannels(channels: KitChannel[]): KitChannel[] {
  return channels.filter((c) => c.key !== MASTER_CHANNEL_KEY);
}

// "Where to post" labels for the checklist.
export function buildPostChecklist(channels: KitChannel[]): string[] {
  return postChannels(channels).map((c) => c.label);
}

// The single copy-everything blob. Deterministic, house-rules-clean. Includes
// the landing link only when the rental is Live (landingUrl non-null).
export function buildCombinedText(opts: {
  businessName: string | null;
  address: string;
  landingUrl: string | null;
  missingLinkText?: string;
  channels: KitChannel[];
}): string {
  const { businessName, address, landingUrl, missingLinkText, channels } = opts;
  const lines: string[] = [];

  const header = businessName ? `${businessName} - ${address}` : address;
  lines.push(header);
  if (landingUrl) {
    lines.push(`Details and apply: ${landingUrl}`);
  } else {
    lines.push(
      `(${missingLinkText ?? "Set this rental Live to include your public listing link."})`,
    );
  }
  lines.push("");

  // Prefer the real channels; if only the master exists, still emit it so the
  // blob is never empty.
  const ordered = channels.length > 0 ? channels : [];
  for (const c of ordered) {
    lines.push(`== ${c.label} ==`);
    if (c.title.trim().length > 0) lines.push(c.title);
    if (c.body.trim().length > 0) {
      lines.push("");
      lines.push(c.body);
    }
    lines.push("");
  }

  // Trim a single trailing blank line for a clean paste.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// Assemble the whole kit from the already-built channel copy + the landing link.
export function buildMarketingKit(opts: {
  businessName: string | null;
  address: string;
  landingUrl: string | null;
  missingLinkText?: string;
  channels: KitChannel[];
}): MarketingKit {
  const { businessName, address, landingUrl, missingLinkText, channels } = opts;
  return {
    landingUrl,
    channels,
    combinedText: buildCombinedText({
      businessName,
      address,
      landingUrl,
      missingLinkText,
      channels,
    }),
    postChecklist: buildPostChecklist(channels),
  };
}

// A safe, descriptive filename for the downloaded QR (no spaces / unsafe chars).
export function qrFilename(address: string): string {
  const slug = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `listing-qr-${slug || "rental"}.svg`;
}
