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
//
// S736 (review item 9, the phone): most small landlords post from the
// Facebook app. On a phone the kit saves the photos through the phone's own
// share sheet instead of a zip, a computer shows a code to scan (or emails the
// link) that opens a no-sign-in kit page on the phone, and the "Copy link"
// Facebook's app gives (facebook.com/share/...) is turned into the ad's own
// link before it is saved.
// ============================================================================

import { formatAvailability } from "@/lib/property-features";

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

// ---------------------------------------------------------------------------
// S736: the phone half of the kit.
// ---------------------------------------------------------------------------

export type MarketplaceKitFactsInput = {
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  address: string | null;
  available_date: string | null;
};

/** The details Marketplace's form asks for, in its order. One builder for every kit page. */
export function marketplaceKitFacts(p: MarketplaceKitFactsInput): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  if (p.rent_cents) facts.push({ label: "Price per month", value: `$${Math.round(p.rent_cents / 100).toLocaleString("en-US")}` });
  if (p.beds != null) facts.push({ label: "Bedrooms", value: String(p.beds) });
  if (p.baths != null) facts.push({ label: "Bathrooms", value: String(p.baths) });
  if (p.sqft) facts.push({ label: "Square feet", value: String(p.sqft) });
  if (p.address) facts.push({ label: "Address", value: p.address });
  facts.push({ label: "Available", value: formatAvailability(p.available_date).replace(/^Available /, "") });
  return facts;
}

/** True when the photo sits in our own public property-photos bucket. */
export function isOwnPhotoBucketUrl(url: string, supabaseBase: string | null | undefined): boolean {
  const base = (supabaseBase ?? "").replace(/\/+$/, "");
  if (!base) return false;
  return url.startsWith(`${base}/storage/v1/object/public/property-photos/`);
}

/** The photo links a phone saves through its share sheet: our bucket only, display order, capped. */
export function marketplaceKitPhotoUrls(
  orderedUrls: ReadonlyArray<string>,
  supabaseBase: string | null | undefined,
): string[] {
  return orderedUrls.filter((u) => isOwnPhotoBucketUrl(u, supabaseBase)).slice(0, MARKETPLACE_KIT_MAX_PHOTOS);
}

/** A facebook.com/share/... link, which Facebook's app gives from Share, then Copy link. */
export function isFacebookShareLink(value: string | null | undefined): boolean {
  try {
    const u = new URL(String(value ?? "").trim());
    const host = u.hostname.toLowerCase();
    if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.me")) return false;
    if (host === "fb.me") return u.pathname.length > 1;
    return /^\/share\/[a-z]?\/?[A-Za-z0-9_-]+\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * The ad's own link, read from where a share link leads: a redirect Location,
 * or a page's canonical / og:url. "https://www.facebook.com/marketplace/item/123/"
 * or null. Only the numeric item id is kept, so tracking tails are dropped.
 */
export function marketplaceItemUrlFrom(text: string | null | undefined): string | null {
  const s = String(text ?? "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const m = /facebook\.com\/marketplace\/item\/(\d{6,})/i.exec(s);
  return m ? `https://www.facebook.com/marketplace/item/${m[1]}/` : null;
}

/** How long a phone link from the computer keeps working. */
export const MARKETPLACE_PHONE_LINK_DAYS = 14;

/** The no-sign-in kit page a landlord opens on their phone. */
export function marketplacePhoneKitPath(token: string): string {
  return `/kit/${encodeURIComponent(token)}`;
}
