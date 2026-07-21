import seed from "./data/rent-benchmarks.seed.json";

export type BenchmarkUnitClass = "purpose_built" | "condo" | "all";

export type RentBenchmarkRow = {
  country: string;
  geography: string;
  geography_label: string;
  match_cities: string[];
  beds: number;
  avg_rent_cents: number;
  unit_class: BenchmarkUnitClass;
  source: string;
  report: string;
  period: string;
  note?: string;
};

type RentBenchmarkSeed = {
  benchmarks: RentBenchmarkRow[];
};

export type BenchmarksForInput = {
  country?: string | null;
  city?: string | null;
  beds?: number | null;
};

const RENT_BENCHMARK_SEED = seed as RentBenchmarkSeed;

export const RENT_BENCHMARKS: readonly RentBenchmarkRow[] =
  RENT_BENCHMARK_SEED.benchmarks;

export function normalizeBenchmarkCity(
  value: string | null | undefined,
): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function benchmarksFor({
  country = "CA",
  city,
  beds,
}: BenchmarksForInput): RentBenchmarkRow[] {
  const countryKey = normalizeCountry(country);
  const cityKey = normalizeBenchmarkCity(city);
  const bedCount = normalizeBeds(beds);
  if (!countryKey || !cityKey || bedCount == null) return [];

  return RENT_BENCHMARKS.filter(
    (row) =>
      normalizeCountry(row.country) === countryKey &&
      row.beds === bedCount &&
      row.match_cities.some((match) => normalizeBenchmarkCity(match) === cityKey),
  ).sort(compareBenchmarkRecency);
}

export function cityFromBenchmarkAddress(
  address: string | null | undefined,
): string | null {
  if (!address || !address.trim()) return null;
  const cities = benchmarkCitiesByLongestName();
  const commaParts = address
    .split(",")
    .slice(1)
    .map(stripAddressRegion)
    .filter(Boolean);

  for (const city of cities) {
    const key = normalizeBenchmarkCity(city);
    for (const part of commaParts) {
      if (part === key || part.startsWith(`${key} `)) {
        return displayCityName(city);
      }
    }
  }

  const tail = stripAddressRegion(address);
  for (const city of cities) {
    const key = normalizeBenchmarkCity(city);
    if (tail === key || tail.endsWith(` ${key}`)) return displayCityName(city);
  }
  return null;
}

export function compareBenchmarkRecency(
  a: RentBenchmarkRow,
  b: RentBenchmarkRow,
): number {
  return (
    periodRank(b.period) - periodRank(a.period) ||
    a.source.localeCompare(b.source) ||
    a.geography.localeCompare(b.geography) ||
    a.unit_class.localeCompare(b.unit_class)
  );
}

function normalizeCountry(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeBeds(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;
  return value;
}

function benchmarkCitiesByLongestName(): string[] {
  const cities = new Map<string, string>();
  for (const row of RENT_BENCHMARKS) {
    for (const city of row.match_cities) {
      const key = normalizeBenchmarkCity(city);
      if (key && !cities.has(key)) cities.set(key, city);
    }
  }
  return [...cities.values()].sort(
    (a, b) => normalizeBenchmarkCity(b).length - normalizeBenchmarkCity(a).length,
  );
}

function displayCityName(city: string): string {
  return city
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 2
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function stripAddressRegion(value: string): string {
  return normalizeBenchmarkCity(value)
    .replace(/\b[a-z]\d[a-z]\s*\d[a-z]\d\b/g, " ")
    .replace(/\b(?:ontario|on|canada|ca)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function periodRank(period: string): number {
  const quarter = period.match(/\b(20\d{2})\s*[- ]?\s*Q([1-4])\b/i);
  if (quarter) return Number(quarter[1]) * 10 + Number(quarter[2]);

  const year = period.match(/\b(20\d{2})\b/);
  if (!year) return 0;
  const monthRank = /\boct(?:ober)?\b/i.test(period)
    ? 4
    : /\b(?:jul|july|aug|august|sep|sept|september)\b/i.test(period)
      ? 3
      : /\b(?:apr|april|may|jun|june)\b/i.test(period)
        ? 2
        : /\b(?:jan|january|feb|february|mar|march)\b/i.test(period)
          ? 1
          : 0;
  return Number(year[1]) * 10 + monthRank;
}
