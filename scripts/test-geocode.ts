// Unit tests for the pure geocode/provider seam. Run: npx tsx scripts/test-geocode.ts
import {
  getGeocodeProvider,
  isValidLatLng,
  normalizeRadarAutocomplete,
  normalizeRadarGeocode,
  parseLatLng,
  resolveGeocodeProviderName,
} from "../lib/geocode";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function eq(name: string, got: unknown, want: unknown) {
  ok(name, got === want);
  if (got !== want) {
    console.error(`    got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function env(values: Record<string, string | undefined>) {
  return values;
}

eq("provider default without Radar key -> none", resolveGeocodeProviderName(env({})), "none");
eq(
  "provider Radar with key -> radar",
  resolveGeocodeProviderName(env({ RADAR_API_KEY: "rk_test" })),
  "radar",
);
eq(
  "provider google without key -> none",
  resolveGeocodeProviderName(env({ GEOCODE_PROVIDER: "google" })),
  "none",
);
eq(
  "provider mapbox without key -> none",
  resolveGeocodeProviderName(env({ GEOCODE_PROVIDER: "mapbox" })),
  "none",
);

const originalFetch = globalThis.fetch;
let fetchCalled = false;
async function main() {
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("should not fetch", { status: 500 });
  }) as typeof fetch;

  try {
    const nullProvider = getGeocodeProvider(env({}));
    eq("Null provider name", nullProvider.name, "none");
    eq(
      "Null autocomplete no-ops",
      JSON.stringify(await nullProvider.autocomplete("123 Main")),
      "[]",
    );
    eq("Null geocode no-ops", await nullProvider.geocode("123 Main"), null);
    ok("Null provider makes no network call", !fetchCalled);
  } finally {
    globalThis.fetch = originalFetch;
  }

  ok("valid Toronto lat/lng accepted", isValidLatLng(43.65, -79.38));
  ok("string lat/lng accepted", isValidLatLng("43.65", "-79.38"));
  ok("0,0 rejected", !isValidLatLng(0, 0));
  ok("out-of-range latitude rejected", !isValidLatLng(91, -79.38));
  ok("out-of-range longitude rejected", !isValidLatLng(43.65, -181));
  ok("NaN latitude rejected", !isValidLatLng("NaN", "-79.38"));
  ok("empty lat/lng rejected", !isValidLatLng("", ""));

  const parsed = parseLatLng("43.65", "-79.38");
  ok(
    "parseLatLng returns coordinates",
    parsed?.latitude === 43.65 && parsed.longitude === -79.38,
  );
  eq("parseLatLng rejects 0,0", parseLatLng("0", "0"), null);

  const radarSample = {
    addresses: [
      {
        formattedAddress: "123 Main St, Toronto, ON M5V 1A1",
        latitude: 43.65,
        longitude: -79.38,
        placeId: "radar-1",
        country: "CA",
      },
      {
        formattedAddress: "456 Missing Coords, Toronto, ON",
        country: "CA",
      },
      {
        number: "789",
        street: "Queen St W",
        city: "Toronto",
        state: "ON",
        postalCode: "M6J 1G5",
        latitude: 43.641,
        longitude: -79.43,
        id: "radar-2",
      },
      {
        formattedAddress: "Null Island",
        latitude: 0,
        longitude: 0,
        id: "bad",
      },
    ],
  };

  const suggestions = normalizeRadarAutocomplete(radarSample);
  eq("Radar autocomplete drops invalid rows", suggestions.length, 2);
  eq(
    "Radar autocomplete maps formatted label",
    suggestions[0]?.label,
    "123 Main St, Toronto, ON M5V 1A1",
  );
  eq("Radar autocomplete maps provider id", suggestions[0]?.providerId, "radar-1");
  eq(
    "Radar autocomplete builds fallback label",
    suggestions[1]?.label,
    "789, Queen St W, Toronto, ON, M6J 1G5",
  );
  ok(
    "Radar autocomplete maps coords",
    suggestions[1]?.latitude === 43.641 && suggestions[1]?.longitude === -79.43,
  );

  const geocode = normalizeRadarGeocode(radarSample);
  ok(
    "Radar geocode maps first valid coordinates",
    geocode?.latitude === 43.65 &&
      geocode.longitude === -79.38 &&
      geocode.formattedAddress === "123 Main St, Toronto, ON M5V 1A1",
  );
  eq(
    "Radar geocode returns null without valid coordinates",
    normalizeRadarGeocode({
      addresses: [{ formattedAddress: "Bad", latitude: 0, longitude: 0 }],
    }),
    null,
  );

  if (failed > 0) {
    console.error(`geocode: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  console.log(`geocode: ${passed} passed, ${failed} failed`);
}

void main();
