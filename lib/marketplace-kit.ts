// ============================================================================
// marketplace-kit (S712). Facebook Marketplace for every org, posted by the
// org's own team.
//
// Marketplace has no API and only personal profiles may post rentals, so no
// robot and no shared Vacantless profile can post it (one ban would take every
// org's ads down). Instead the landlord, or one of their showing agents, posts
// it from their own Facebook using this kit:
//   1. copy the ad text (it carries the rental's booking link),
//   2. download the photos,
//   3. open Marketplace's "Property for rent" form,
//   4. paste the link to the finished ad back, so the rental shows it as live.
// Pure helpers only; the zip route and the agent page live in app/.
// ============================================================================

/** Marketplace's own "Property for rent" form. */
export const MARKETPLACE_CREATE_RENTAL_URL = "https://www.facebook.com/marketplace/create/rental";

/** Marketplace takes up to 50 photos; more than this only slows the download. */
export const MARKETPLACE_KIT_MAX_PHOTOS = 30;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/** "01-photo.jpg", "02-photo.png" ... in display order, cover first. */
export function marketplacePhotoFileName(index: number, url: string): string {
  let ext = "jpg";
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9]+)$/i.exec(path);
    if (m && IMAGE_EXTS.has(m[1].toLowerCase())) ext = m[1].toLowerCase();
  } catch {
    // keep jpg
  }
  return `${String(index + 1).padStart(2, "0")}-photo.${ext === "jpeg" ? "jpg" : ext}`;
}

/** A safe zip file name from the rental address: "100-test-street-photos.zip". */
export function marketplacePhotosZipName(address: string | null | undefined): string {
  const slug = (address ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "rental"}-photos.zip`;
}

/** The no-login kit page a showing agent opens from their email. */
export function agentMarketplaceKitPath(agentToken: string, propertyId: string): string {
  return `/agent/${encodeURIComponent(agentToken)}/marketplace/${encodeURIComponent(propertyId)}`;
}

export type MarketplaceKitAgent = { id: string; name: string };

/** Agents who can be sent the kit: not archived and with an email to send to. */
export function marketplaceKitAgents(
  rows: ReadonlyArray<{ id: string; name: string | null; email: string | null; archived?: boolean | null }>,
): MarketplaceKitAgent[] {
  return rows
    .filter((r) => !r.archived && (r.email ?? "").trim() !== "")
    .map((r) => ({ id: r.id, name: (r.name ?? "").trim() || (r.email as string) }));
}
