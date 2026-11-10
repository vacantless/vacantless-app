import { citySlug, parseCityFromAddress } from "@/lib/browse-surface";

/**
 * S777 (PLAN-S775 Phase 5): "Check for copies".
 *
 * Scammers copy real rental ads, often at a lower price. Kijiji's terms forbid
 * robots collecting its ads and Marketplace needs a signed-in Facebook
 * account, so Vacantless does NOT watch for copies. Instead it builds three
 * searches the landlord opens in their own browser: Kijiji long-term rentals
 * in the rental's city at a nearby price, Marketplace rentals at that price,
 * and a Google Lens search of the cover photo.
 */

export type CopyCheckInput = {
  address: string | null;
  rentCents: number | null;
  beds: number | null;
  coverPhotoUrl: string | null;
};

export type CopyCheckLinks = {
  city: string | null;
  priceLabel: string | null;
  kijiji: string | null;
  marketplace: string | null;
  /** The city the Marketplace search is pinned to, or null when it uses the landlord's own Marketplace location. */
  marketplaceCity: string | null;
  lens: string | null;
};

/**
 * Marketplace city paths proven on 2026-11-10 (each opened "<City>, <Province>
 * Within 65 km"). A name shared with another place is NOT safe: "london" opens
 * London, United Kingdom, and an unknown name falls back to the viewer's own
 * location. Add a city only after opening its link and reading the filter.
 */
export const MARKETPLACE_CITY_SLUGS: ReadonlySet<string> = new Set([
  "windsor",
  "toronto",
  "ottawa",
  "hamilton",
  "calgary",
  "edmonton",
  "vancouver",
]);

const PROVINCE = /^(on|ontario|bc|ab|mb|sk|qc|ns|nb|nl|pe|pei|yt|nt|nu)\b/i;

/** City from the address: the known-city list first, else the part before the province. */
export function copyCheckCity(address: string | null | undefined): string | null {
  if (!address) return null;
  const known = parseCityFromAddress(address);
  if (known) return known;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    if (PROVINCE.test(parts[i]) && !/\d/.test(parts[i - 1]) && i - 1 > 0) return parts[i - 1];
  }
  return null;
}

/** Copies usually undercut the real price: search from 70% to 110% of the rent, in whole dollars. */
export function copyCheckPriceWindow(rentCents: number | null): { low: number; high: number } | null {
  if (typeof rentCents !== "number" || !(rentCents > 0)) return null;
  const rent = rentCents / 100;
  return { low: Math.floor((rent * 0.7) / 50) * 50, high: Math.ceil((rent * 1.1) / 50) * 50 };
}

export function copyCheckLinks(input: CopyCheckInput): CopyCheckLinks {
  const city = copyCheckCity(input.address);
  const price = copyCheckPriceWindow(input.rentCents);
  const slug = city ? citySlug(city) : "";

  let kijiji: string | null = null;
  if (slug && price) {
    kijiji = `https://www.kijiji.ca/b-apartments-condos/canada/${encodeURIComponent(slug)}/k0c37l0?price=${price.low}__${price.high}`;
  }

  let marketplace: string | null = null;
  let marketplaceCity: string | null = null;
  if (price) {
    const q = new URLSearchParams({ minPrice: String(price.low), maxPrice: String(price.high) });
    if (typeof input.beds === "number" && input.beds > 0) q.set("minBedrooms", String(Math.floor(input.beds)));
    const pinned = slug && MARKETPLACE_CITY_SLUGS.has(slug);
    marketplace = pinned
      ? `https://www.facebook.com/marketplace/${slug}/propertyrentals?${q.toString()}`
      : `https://www.facebook.com/marketplace/category/propertyrentals?${q.toString()}`;
    marketplaceCity = pinned ? city : null;
  }

  let lens: string | null = null;
  if (input.coverPhotoUrl && /^https:\/\//i.test(input.coverPhotoUrl)) {
    lens = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(input.coverPhotoUrl)}`;
  }

  return {
    city,
    priceLabel: price ? `$${price.low.toLocaleString("en-CA")} to $${price.high.toLocaleString("en-CA")}` : null,
    kijiji,
    marketplace,
    marketplaceCity,
    lens,
  };
}
