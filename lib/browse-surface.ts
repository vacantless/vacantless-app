// ============================================================================
// Pure helpers for the public /rentals browse surface.
// No DOM / env / IO. The pages own the dark gate and RPC reads.
// ============================================================================

import {
  listingFeedReadiness,
  type FeedListingInput,
} from "./listing-feed";
import { buildSpecLine, formatAvailability } from "./property-features";

export type BrowseListing = FeedListingInput;

export type BrowseProvider = {
  org: {
    name: string | null;
  } | null;
  listings: BrowseListing[] | null;
};

export type BrowseCard = {
  id: string;
  address: string;
  rentCents: number | null;
  specLine: string;
  availability: string;
  city: string;
  citySlug: string;
  coverPhoto: string | null;
  orgName: string;
};

export type BrowseCityGroup = {
  city: string;
  citySlug: string;
  listings: BrowseCard[];
};

export type BrowseIndex = {
  cities: BrowseCityGroup[];
  totalCount: number;
};

export const BROWSE_CITY_ALLOWLIST = [
  "Toronto",
  "Ottawa",
  "Mississauga",
  "Brampton",
  "Hamilton",
  "London",
  "Markham",
  "Vaughan",
  "Kitchener",
  "Windsor",
  "Richmond Hill",
  "Oakville",
  "Burlington",
  "Oshawa",
  "Barrie",
  "Guelph",
  "Cambridge",
  "Waterloo",
  "St. Catharines",
  "Kingston",
] as const;

export type BrowseCity = (typeof BROWSE_CITY_ALLOWLIST)[number];

const ONTARIO_GROUP = "Ontario";
const POSTAL_CODE_RE = /\b[a-z]\d[a-z]\s*\d[a-z]\d\b/gi;

const CITIES_BY_LONGEST_NAME = [...BROWSE_CITY_ALLOWLIST].sort(
  (a, b) => normalizeForCityMatch(b).length - normalizeForCityMatch(a).length,
);

export function browseReady(listing: BrowseListing): boolean {
  // Browse reuses the feed's listing-level ad floor. The feed's org phone rule
  // is intentionally not part of browse readiness because /rentals never shows
  // org contact details; every card routes into the existing /r inquiry flow.
  return listingFeedReadiness(listing).ready;
}

export function parseCityFromAddress(
  address: string | null | undefined,
): string | null {
  if (!address || !address.trim()) return null;

  const commaParts = address
    .split(",")
    .map(stripProvincePostalAndCountry)
    .filter(Boolean);

  for (const city of CITIES_BY_LONGEST_NAME) {
    const key = normalizeForCityMatch(city);
    for (const part of commaParts.slice(1)) {
      if (part === key || part.startsWith(`${key} `)) return city;
    }
  }

  const fullTail = stripProvincePostalAndCountry(address);
  for (const city of CITIES_BY_LONGEST_NAME) {
    const key = normalizeForCityMatch(city);
    if (fullTail === key || fullTail.endsWith(` ${key}`)) return city;
  }

  return null;
}

export function citySlug(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cityFromSlug(slug: string | null | undefined): string | null {
  if (!slug || typeof slug !== "string") return null;
  const normalized = citySlug(slug);
  for (const city of BROWSE_CITY_ALLOWLIST) {
    if (citySlug(city) === normalized) return city;
  }
  return null;
}

export function buildBrowseIndex(
  providers: ReadonlyArray<BrowseProvider> | null | undefined,
): BrowseIndex {
  const groups = new Map<string, BrowseCityGroup>();

  for (const provider of providers ?? []) {
    const orgName = provider.org?.name?.trim() || "Vacantless landlord";
    for (const listing of provider.listings ?? []) {
      if (!browseReady(listing)) continue;

      const address = listing.address?.trim() ?? "";
      const parsedCity = parseCityFromAddress(address);
      const city = parsedCity ?? ONTARIO_GROUP;
      const slug = citySlug(city);
      const group =
        groups.get(city) ??
        {
          city,
          citySlug: slug,
          listings: [],
        };

      group.listings.push({
        id: listing.id,
        address,
        rentCents: normalizeRentCents(listing.rent_cents),
        specLine: buildSpecLine({
          ...listing,
          baths: normalizeNumber(listing.baths),
        }).join(" · "),
        availability: formatAvailability(listing.available_date),
        city,
        citySlug: slug,
        coverPhoto: firstPhoto(listing.photos),
        orgName,
      });
      groups.set(city, group);
    }
  }

  const cities = [...groups.values()].map((group) => ({
    ...group,
    listings: [...group.listings].sort(compareCards),
  }));

  cities.sort(compareCityGroups);

  return {
    cities,
    totalCount: cities.reduce((sum, city) => sum + city.listings.length, 0),
  };
}

export function detailHref(id: string): string {
  return `/r/${encodeURIComponent(id)}?src=network`;
}

function firstPhoto(photos: string[] | null | undefined): string | null {
  if (!Array.isArray(photos)) return null;
  const first = photos[0];
  return typeof first === "string" && first.trim() ? first : null;
}

function normalizeRentCents(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value);
}

function normalizeNumber(
  value: number | string | null | undefined,
): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function compareCards(a: BrowseCard, b: BrowseCard): number {
  const rentA = a.rentCents ?? Number.MAX_SAFE_INTEGER;
  const rentB = b.rentCents ?? Number.MAX_SAFE_INTEGER;
  return (
    rentA - rentB ||
    a.address.localeCompare(b.address) ||
    a.id.localeCompare(b.id)
  );
}

function compareCityGroups(a: BrowseCityGroup, b: BrowseCityGroup): number {
  if (a.city === ONTARIO_GROUP && b.city !== ONTARIO_GROUP) return 1;
  if (b.city === ONTARIO_GROUP && a.city !== ONTARIO_GROUP) return -1;
  return (
    b.listings.length - a.listings.length ||
    a.city.localeCompare(b.city)
  );
}

function stripProvincePostalAndCountry(value: string): string {
  return normalizeForCityMatch(value)
    .replace(POSTAL_CODE_RE, " ")
    .replace(/\b(?:ontario|on|canada|ca)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCityMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
