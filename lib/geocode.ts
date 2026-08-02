export type GeocodeSuggestion = {
  label: string;
  latitude: number | null;
  longitude: number | null;
  providerId: string | null;
};

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
};

export interface GeocodeProvider {
  readonly name: string;
  autocomplete(query: string, signal?: AbortSignal): Promise<GeocodeSuggestion[]>;
  geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult | null>;
}

export type GeocodeProviderName = "radar" | "geoapify" | "google" | "mapbox" | "none";

type GeocodeEnv = Record<string, string | undefined>;

const RADAR_BASE_URL = "https://api.radar.io/v1";
const RADAR_TIMEOUT_MS = 4000;
const GEOAPIFY_BASE_URL = "https://api.geoapify.com/v1/geocode";
const GEOAPIFY_TIMEOUT_MS = 4000;

function cleanEnv(value: string | undefined): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s+/g, " ");
  return v ? v : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const latitude = numberValue(lat);
  const longitude = numberValue(lng);
  if (latitude == null || longitude == null) return false;
  if (latitude === 0 && longitude === 0) return false;
  return (
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function parseLatLng(
  latRaw: unknown,
  lngRaw: unknown,
): { latitude: number; longitude: number } | null {
  const latitude = numberValue(latRaw);
  const longitude = numberValue(lngRaw);
  if (!isValidLatLng(latitude, longitude)) return null;
  return { latitude: latitude!, longitude: longitude! };
}

export function resolveGeocodeProviderName(
  env: GeocodeEnv = process.env,
): GeocodeProviderName {
  const configured = cleanEnv(env.GEOCODE_PROVIDER)?.toLowerCase() ?? "radar";
  if (configured === "none") return "none";
  if (configured === "radar") {
    return cleanEnv(env.RADAR_API_KEY) ? "radar" : "none";
  }
  if (configured === "geoapify") {
    return cleanEnv(env.GEOAPIFY_API_KEY) ? "geoapify" : "none";
  }
  if (configured === "google") {
    return cleanEnv(env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_GEOCODE_API_KEY)
      ? "google"
      : "none";
  }
  if (configured === "mapbox") {
    return cleanEnv(env.MAPBOX_ACCESS_TOKEN ?? env.MAPBOX_API_KEY)
      ? "mapbox"
      : "none";
  }
  return "none";
}

function radarAddresses(json: unknown): Record<string, unknown>[] {
  const root = recordValue(json);
  const addresses = root?.addresses;
  return Array.isArray(addresses)
    ? addresses
        .map((item) => recordValue(item))
        .filter((item): item is Record<string, unknown> => item != null)
    : [];
}

function radarLatLng(address: Record<string, unknown>) {
  return parseLatLng(
    address.latitude ?? address.lat,
    address.longitude ?? address.lng,
  );
}

function radarLabel(address: Record<string, unknown>): string | null {
  const direct =
    cleanText(address.formattedAddress) ??
    cleanText(address.addressLabel) ??
    cleanText(address.name);
  if (direct) return direct;

  const parts = [
    cleanText(address.number),
    cleanText(address.street),
    cleanText(address.city),
    cleanText(address.state),
    cleanText(address.postalCode),
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(", ") : null;
}

function radarProviderId(address: Record<string, unknown>): string | null {
  return (
    cleanText(address.placeId) ??
    cleanText(address.id) ??
    cleanText(address._id) ??
    null
  );
}

export function normalizeRadarAutocomplete(json: unknown): GeocodeSuggestion[] {
  const suggestions: GeocodeSuggestion[] = [];
  const seen = new Set<string>();
  for (const address of radarAddresses(json)) {
    const coords = radarLatLng(address);
    const label = radarLabel(address);
    if (!coords || !label) continue;
    const key = `${label}|${coords.latitude}|${coords.longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      label,
      latitude: coords.latitude,
      longitude: coords.longitude,
      providerId: radarProviderId(address),
    });
  }
  return suggestions;
}

export function normalizeRadarGeocode(json: unknown): GeocodeResult | null {
  for (const address of radarAddresses(json)) {
    const coords = radarLatLng(address);
    if (!coords) continue;
    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      formattedAddress: radarLabel(address),
    };
  }
  return null;
}

function geoapifyFeatures(json: unknown): Record<string, unknown>[] {
  const root = recordValue(json);
  const features = root?.features;
  return Array.isArray(features)
    ? features
        .map((item) => recordValue(item))
        .filter((item): item is Record<string, unknown> => item != null)
    : [];
}

function geoapifyProperties(feature: Record<string, unknown>): Record<string, unknown> {
  return recordValue(feature.properties) ?? {};
}

function geoapifyGeometryLatLng(feature: Record<string, unknown>) {
  const geometry = recordValue(feature.geometry);
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  return parseLatLng(coordinates[1], coordinates[0]);
}

function geoapifyLatLng(feature: Record<string, unknown>) {
  const properties = geoapifyProperties(feature);
  return parseLatLng(properties.lat, properties.lon) ?? geoapifyGeometryLatLng(feature);
}

function geoapifyLabel(feature: Record<string, unknown>): string | null {
  const properties = geoapifyProperties(feature);
  const direct = cleanText(properties.formatted);
  if (direct) return direct;

  const firstLine = cleanText(properties.address_line1);
  const secondLine = cleanText(properties.address_line2);
  if (firstLine && secondLine) return `${firstLine}, ${secondLine}`;

  const parts = [
    firstLine,
    cleanText(properties.city),
    cleanText(properties.state),
    cleanText(properties.postcode),
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(", ") : null;
}

function geoapifyProviderId(feature: Record<string, unknown>): string | null {
  return cleanText(geoapifyProperties(feature).place_id);
}

export function normalizeGeoapifyAutocomplete(json: unknown): GeocodeSuggestion[] {
  const suggestions: GeocodeSuggestion[] = [];
  const seen = new Set<string>();
  for (const feature of geoapifyFeatures(json)) {
    const coords = geoapifyLatLng(feature);
    const label = geoapifyLabel(feature);
    if (!coords || !label) continue;
    const key = `${label}|${coords.latitude}|${coords.longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      label,
      latitude: coords.latitude,
      longitude: coords.longitude,
      providerId: geoapifyProviderId(feature),
    });
  }
  return suggestions;
}

export function normalizeGeoapifyGeocode(json: unknown): GeocodeResult | null {
  for (const feature of geoapifyFeatures(json)) {
    const coords = geoapifyLatLng(feature);
    if (!coords) continue;
    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      formattedAddress: geoapifyLabel(feature),
    };
  }
  return null;
}

class NullGeocodeProvider implements GeocodeProvider {
  readonly name = "none";
  async autocomplete(): Promise<GeocodeSuggestion[]> {
    return [];
  }
  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }
}

class UnimplementedGeocodeProvider implements GeocodeProvider {
  constructor(readonly name: string) {}
  async autocomplete(): Promise<GeocodeSuggestion[]> {
    throw new Error(`${this.name} geocode provider not implemented`);
  }
  async geocode(): Promise<GeocodeResult | null> {
    throw new Error(`${this.name} geocode provider not implemented`);
  }
}

class RadarGeocodeProvider implements GeocodeProvider {
  readonly name = "radar";

  constructor(private readonly apiKey: string) {}

  private async request(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown | null> {
    const url = new URL(`${RADAR_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RADAR_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: this.apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      try {
        return (await res.json()) as unknown;
      } catch {
        return null;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async autocomplete(query: string, signal?: AbortSignal): Promise<GeocodeSuggestion[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    const json = await this.request(
      "/search/autocomplete",
      { query: q, country: "CA", limit: "6" },
      signal,
    );
    return normalizeRadarAutocomplete(json);
  }

  async geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
    const q = query.trim();
    if (q.length < 3) return null;
    const json = await this.request(
      "/geocode/forward",
      { query: q, country: "CA", limit: "1" },
      signal,
    );
    return normalizeRadarGeocode(json);
  }
}

class GeoapifyGeocodeProvider implements GeocodeProvider {
  readonly name = "geoapify";

  constructor(private readonly apiKey: string) {}

  private async request(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown | null> {
    const url = new URL(`${GEOAPIFY_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("apiKey", this.apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOAPIFY_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      try {
        return (await res.json()) as unknown;
      } catch {
        return null;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async autocomplete(query: string, signal?: AbortSignal): Promise<GeocodeSuggestion[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    const json = await this.request(
      "/autocomplete",
      { text: q, filter: "countrycode:ca", limit: "6" },
      signal,
    );
    return normalizeGeoapifyAutocomplete(json);
  }

  async geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
    const q = query.trim();
    if (q.length < 3) return null;
    const json = await this.request(
      "/search",
      { text: q, filter: "countrycode:ca", limit: "1" },
      signal,
    );
    return normalizeGeoapifyGeocode(json);
  }
}

export function getGeocodeProvider(env: GeocodeEnv = process.env): GeocodeProvider {
  const provider = resolveGeocodeProviderName(env);
  if (provider === "radar") {
    const key = cleanEnv(env.RADAR_API_KEY);
    return key ? new RadarGeocodeProvider(key) : new NullGeocodeProvider();
  }
  if (provider === "geoapify") {
    const key = cleanEnv(env.GEOAPIFY_API_KEY);
    return key ? new GeoapifyGeocodeProvider(key) : new NullGeocodeProvider();
  }
  if (provider === "google") return new UnimplementedGeocodeProvider("google");
  if (provider === "mapbox") return new UnimplementedGeocodeProvider("mapbox");
  return new NullGeocodeProvider();
}
