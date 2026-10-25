// ============================================================================
// The Marketplace helper (S735): the Vacantless Chrome extension that fills
// Facebook Marketplace's "Property for rent" form in the landlord's own
// browser, from the rental's kit, photos included.
//
// Why an extension: Facebook has no Marketplace API for anyone, and only a
// person's own profile may post a rental. The helper runs in that person's
// own Chrome, on their own Facebook, on their click. It never signs in, never
// presses Publish, never reads anything off Facebook.
//
// How the two sides talk: the rental page in the app and the helper's content
// script share the page's window.postMessage, same origin only. The app sends
// a ping, the helper answers with its version. The app sends the kit; the
// helper stores it for the Marketplace tab it opens. No network call, no app
// route, no token: the kit is what the page already shows the landlord.
//
// Pure helpers only (no DOM, no env, no IO); the row owns the messaging.
// ============================================================================

import { MARKETPLACE_CREATE_RENTAL_URL } from "./marketplace-kit";

/** The message source tags. Kept in lockstep with vacantless-extension/config.js. */
export const MARKETPLACE_HELPER_APP_SOURCE = "vacantless-app";
export const MARKETPLACE_HELPER_EXT_SOURCE = "vacantless-helper";

/** The smallest helper version that understands a v1 kit. */
export const MARKETPLACE_HELPER_MIN_VERSION = "1.0.0";

/** Where a landlord gets the helper: its Chrome Web Store page (unlisted,
 *  approved 2026-10-25, item mpohpdjmkpeillnmjbhnfhcgofdenepc). */
export const MARKETPLACE_HELPER_INSTALL_URL =
  "https://chromewebstore.google.com/detail/vacantless-helper/mpohpdjmkpeillnmjbhnfhcgofdenepc";

export const MARKETPLACE_HELPER_MAX_PHOTOS = 10;

export type MarketplaceHelperKit = {
  v: 1;
  propertyId: string;
  /** The Marketplace create page the helper opens. */
  createUrl: string;
  title: string;
  priceDollars: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  /** Marketplace's property type, from the unit type (its dropdown offers Apartment, House, Townhouse). */
  propertyType: "apartment" | "house" | "townhouse";
  address: string;
  description: string;
  availableDate: string | null;
  /** Marketplace's own dropdown words, or null to leave the dropdown alone (S735 recon of the live form). */
  laundry: string | null;
  parking: string | null;
  airConditioning: string | null;
  heating: string | null;
  /** Cover first, at most MARKETPLACE_HELPER_MAX_PHOTOS. */
  photoUrls: string[];
  /** The rental's booking page, for the helper's own "paste the link back" note. */
  publicUrl: string;
};

const UNIT_TYPE_TO_MARKETPLACE: Record<string, MarketplaceHelperKit["propertyType"]> = {
  apartment: "apartment",
  condo: "apartment",
  "basement-apartment": "apartment",
  house: "house",
  duplex: "house",
  "duplex-triplex": "house",
  townhouse: "townhouse",
};

// Marketplace's dropdown choices, read off the live form on 2026-10-23:
//   Laundry type: In-unit laundry | Laundry in building | Laundry available | None
//   Parking type: Garage parking | Street parking | Off-street parking | Parking available | None
//   Air conditioning type: Central AC | AC available | None
//   Heating type: Central heating | Electric heating | Gas heating | Radiator heating | Heating available | None
export function marketplaceLaundry(laundry: string | null | undefined): string | null {
  switch ((laundry ?? "").trim()) {
    case "in_suite":
      return "In-unit laundry";
    case "in_building":
    case "shared":
      return "Laundry in building";
    case "none":
      return "None";
    default:
      return null;
  }
}

export function marketplaceParking(
  parkingType: string | null | undefined,
  parkingCount: number | null | undefined,
  parkingText: string | null | undefined,
): string | null {
  switch ((parkingType ?? "").trim()) {
    case "garage":
    case "underground":
      return "Garage parking";
    case "street":
      return "Street parking";
    case "outdoor":
    case "covered":
    case "ev_charging":
      return "Off-street parking";
    case "none":
      return "None";
  }
  if (parkingCount != null && parkingCount > 0) return "Parking available";
  const text = (parkingText ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^(no|none|0)\b/.test(text)) return "None";
  if (/street/.test(text)) return "Street parking";
  if (/garage|underground/.test(text)) return "Garage parking";
  return "Parking available";
}

export function marketplaceAirConditioning(
  airConditioning: boolean | null | undefined,
  acType: string | null | undefined,
): string | null {
  const type = (acType ?? "").trim();
  if (type === "central") return "Central AC";
  if (type === "none") return "None";
  if (type === "window" || type === "portable" || type === "sleeve") return "AC available";
  if (airConditioning === true) return "AC available";
  if (airConditioning === false) return "None";
  return null;
}

export function marketplaceHeating(heatingType: string | null | undefined): string | null {
  switch ((heatingType ?? "").trim()) {
    case "forced_air":
    case "heat_pump":
      return "Central heating";
    case "electric":
    case "baseboard":
      return "Electric heating";
    case "boiler":
    case "radiant":
      return "Radiator heating";
    case "other":
      return "Heating available";
    default:
      return null;
  }
}

export function marketplacePropertyType(unitType: string | null | undefined): MarketplaceHelperKit["propertyType"] {
  const key = (unitType ?? "").trim().toLowerCase();
  return UNIT_TYPE_TO_MARKETPLACE[key] ?? "apartment";
}

/** "2 bedroom apartment for rent, 833 Pillette Rd" (Marketplace titles are short; 100 characters is the cap). */
export function buildMarketplaceTitle(input: {
  beds: number | null | undefined;
  unitType: string | null | undefined;
  address: string | null | undefined;
}): string {
  const typeWord = marketplacePropertyType(input.unitType);
  const bedsPart =
    input.beds != null && Number.isFinite(input.beds)
      ? input.beds === 0
        ? "Bachelor"
        : `${Math.round(input.beds)} bedroom`
      : "";
  const head = [bedsPart, typeWord].filter(Boolean).join(" ");
  const street = streetOf(input.address);
  const title = `${head.charAt(0).toUpperCase()}${head.slice(1)} for rent${street ? `, ${street}` : ""}`;
  return title.length > 100 ? title.slice(0, 97).trimEnd() + "..." : title;
}

/** The street part of an address: "833 Pillette Rd, Unit 3, Windsor, ON" -> "833 Pillette Rd". */
export function streetOf(address: string | null | undefined): string {
  const first = (address ?? "").split(",")[0] ?? "";
  return first.trim();
}

export function buildMarketplaceHelperKit(input: {
  propertyId: string;
  address: string | null | undefined;
  rentCents: number | null | undefined;
  beds: number | null | undefined;
  baths: number | string | null | undefined;
  sqft: number | null | undefined;
  unitType: string | null | undefined;
  description: string;
  availableDate: string | null | undefined;
  laundry?: string | null;
  parkingType?: string | null;
  parkingCount?: number | null;
  parkingText?: string | null;
  airConditioning?: boolean | null;
  acType?: string | null;
  heatingType?: string | null;
  photoUrls: ReadonlyArray<string | null | undefined>;
  publicUrl: string;
}): MarketplaceHelperKit {
  const baths = typeof input.baths === "string" ? Number(input.baths) : input.baths;
  return {
    v: 1,
    propertyId: input.propertyId,
    createUrl: MARKETPLACE_CREATE_RENTAL_URL,
    title: buildMarketplaceTitle({ beds: input.beds, unitType: input.unitType, address: input.address }),
    priceDollars:
      input.rentCents != null && Number.isFinite(input.rentCents) && input.rentCents > 0
        ? Math.round(input.rentCents / 100)
        : null,
    beds: input.beds != null && Number.isFinite(input.beds) ? Math.round(input.beds) : null,
    baths: baths != null && Number.isFinite(baths) ? baths : null,
    sqft: input.sqft != null && Number.isFinite(input.sqft) && input.sqft > 0 ? Math.round(input.sqft) : null,
    propertyType: marketplacePropertyType(input.unitType),
    address: (input.address ?? "").trim(),
    description: input.description.trim(),
    availableDate: input.availableDate ?? null,
    laundry: marketplaceLaundry(input.laundry),
    parking: marketplaceParking(input.parkingType, input.parkingCount, input.parkingText),
    airConditioning: marketplaceAirConditioning(input.airConditioning, input.acType),
    heating: marketplaceHeating(input.heatingType),
    photoUrls: input.photoUrls
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, MARKETPLACE_HELPER_MAX_PHOTOS),
    publicUrl: input.publicUrl,
  };
}

/** True when a helper's version answers a kit of this shape. */
export function helperVersionOk(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
  const [a, b, c] = parse(version);
  const [x, y, z] = parse(MARKETPLACE_HELPER_MIN_VERSION);
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
}

/** The pong the helper sends; anything else on the window is ignored. */
export function isHelperPong(data: unknown): data is { source: string; type: "pong"; version: string } {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.source === MARKETPLACE_HELPER_EXT_SOURCE && d.type === "pong" && typeof d.version === "string";
}
