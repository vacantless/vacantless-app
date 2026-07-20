// ============================================================================
// Pure helpers for public listing SEO and browse attribution.
// No DOM / env / IO.
// ============================================================================

import {
  BROWSE_CITY_ALLOWLIST,
  browseReady,
  citySlug,
  parseCityFromAddress,
  type BrowseProvider,
} from "./browse-surface";
import { clampDescription, rentDollars, type FeedListingInput } from "./listing-feed";
import { buildSpecLine } from "./property-features";

export type ListingSeoInput = FeedListingInput & {
  status?: string | null;
};

export type SitemapEntry = {
  url: string;
};

const FALLBACK_TITLE = "Rental listing";
const FALLBACK_DESCRIPTION =
  "View this rental listing and send an inquiry through Vacantless.";

export function buildListingMetaTitle(listing: ListingSeoInput | null | undefined): string {
  if (!listing) return FALLBACK_TITLE;

  const parts = [
    buildSpecLine({
      ...listing,
      baths: normalizeNumber(listing.baths),
    }).join(" "),
    cleanText(listing.address),
    formatRentForTitle(listing.rent_cents),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" - ") : FALLBACK_TITLE;
}

export function buildListingMetaDescription(
  listing: ListingSeoInput | null | undefined,
): string {
  const description = clampDescription(listing?.description ?? null);
  if (!description) return FALLBACK_DESCRIPTION;
  return truncateAtWord(description, 155);
}

export function buildListingJsonLd(
  listing: ListingSeoInput,
  { canonicalUrl }: { canonicalUrl: string },
): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Apartment",
    name: buildListingMetaTitle(listing),
    url: canonicalUrl,
    address: compactObject({
      "@type": "PostalAddress",
      streetAddress: cleanText(listing.address),
      addressLocality: parseCityFromAddress(listing.address),
      addressRegion: "ON",
      addressCountry: "CA",
    }),
    offers: compactObject({
      "@type": "Offer",
      price: rentDollars(listing.rent_cents),
      priceCurrency: "CAD",
      availability: "https://schema.org/InStock",
    }),
  };

  const photos = Array.isArray(listing.photos)
    ? listing.photos.filter((photo) => cleanText(photo))
    : [];
  if (photos.length > 0) jsonLd.image = photos;
  if (listing.beds != null && Number.isFinite(listing.beds)) {
    jsonLd.numberOfBedrooms = Math.round(listing.beds);
  }
  const baths = normalizeNumber(listing.baths);
  if (baths != null) jsonLd.numberOfBathroomsTotal = baths;
  if (listing.sqft != null && Number.isFinite(listing.sqft) && listing.sqft > 0) {
    jsonLd.floorSize = {
      "@type": "QuantitativeValue",
      value: Math.round(listing.sqft),
      unitText: "sq ft",
    };
  }

  return compactObject(jsonLd);
}

export function jsonLdScriptText(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

export function buildSitemapEntries(
  providers: ReadonlyArray<BrowseProvider> | null | undefined,
  { baseUrl }: { baseUrl: string },
): SitemapEntry[] {
  const root = normalizeBaseUrl(baseUrl);
  const readyListings = collectReadyListings(providers);
  const cities = new Set<string>();

  for (const listing of readyListings) {
    const city = parseCityFromAddress(listing.address);
    if (city) cities.add(city);
  }

  return [
    { url: `${root}/rentals` },
    ...[...cities]
      .sort((a, b) => a.localeCompare(b))
      .map((city) => ({ url: `${root}/rentals/${citySlug(city)}` })),
    ...readyListings
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((listing) => ({
        url: `${root}/r/${encodeURIComponent(listing.id)}`,
      })),
  ];
}

export function leadSourceHintFromParam(value: unknown): "network" | null {
  return value === "network" ? "network" : null;
}

function collectReadyListings(
  providers: ReadonlyArray<BrowseProvider> | null | undefined,
): FeedListingInput[] {
  const listings: FeedListingInput[] = [];
  const allowlistedCities = new Set<string>(BROWSE_CITY_ALLOWLIST);

  for (const provider of providers ?? []) {
    for (const listing of provider.listings ?? []) {
      if (!browseReady(listing)) continue;
      const city = parseCityFromAddress(listing.address);
      if (city && !allowlistedCities.has(city)) continue;
      listings.push(listing);
    }
  }

  return listings;
}

function formatRentForTitle(cents: number | null | undefined): string | null {
  const dollars = rentDollars(cents);
  if (!dollars) return null;
  return `$${Math.round(Number(dollars)).toLocaleString()}/mo`;
}

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}...`;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const numberValue = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeBaseUrl(baseUrl: string): string {
  const fallback = "https://vacantless-app.vercel.app";
  const raw = cleanText(baseUrl) ?? fallback;
  return raw.replace(/\/+$/g, "");
}

function compactObject<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value != null),
  ) as T;
}
