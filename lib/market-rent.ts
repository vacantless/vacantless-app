import { formatMoney } from "./price-drop";
import {
  cityFromBenchmarkAddress,
  compareBenchmarkRecency,
  normalizeBenchmarkCity,
  type BenchmarkUnitClass,
  type RentBenchmarkRow,
} from "./rent-benchmarks";

export const DEFAULT_MARKET_RENT_CONFIG = {
  minSample: 3,
  ownWeight: 0.5,
  spread: 0.08,
} as const;

export type MarketRentConfig = Partial<typeof DEFAULT_MARKET_RENT_CONFIG>;

export type MarketRentSubject = {
  country?: string | null;
  city?: string | null;
  beds?: number | null;
  unitClass?: BenchmarkUnitClass | null;
};

export type LeasedOutcomeComp = {
  asking_rent_cents?: number | null;
  beds?: number | null;
  city?: string | null;
  address?: string | null;
  days_on_market?: number | null;
  leased_at?: string | null;
  available_since?: string | null;
};

export type ActiveListingComp = {
  rent_cents?: number | null;
  beds?: number | null;
  city?: string | null;
  address?: string | null;
  status?: string | null;
};

export type OwnCompsResult = {
  sampleSize: number;
  leasedSampleSize: number;
  activeListingSampleSize: number;
  medianAskingCents: number | null;
  medianDaysOnMarket: number | null;
};

export type MarketRentSuggestion = {
  lowCents: number;
  midCents: number;
  highCents: number;
  confidence: "low" | "medium" | "high";
  anchor: {
    source: string;
    unit_class: BenchmarkUnitClass;
    period: string;
  } | null;
  basis: string[];
};

export function ownComps(
  subject: Pick<MarketRentSubject, "city" | "beds">,
  leasedOutcomes: readonly LeasedOutcomeComp[],
  activeListings: readonly ActiveListingComp[],
  config?: MarketRentConfig,
): OwnCompsResult {
  const minSample = sampleFloor(config?.minSample);
  const cityKey = normalizeBenchmarkCity(subject.city);
  const beds = normalizeBeds(subject.beds);
  if (!cityKey || beds == null) return emptyOwnComps();

  const leasedRents: number[] = [];
  const leasedDays: number[] = [];
  for (const row of leasedOutcomes) {
    if (!rowMatchesSubject(row, cityKey, beds)) continue;
    if (positiveCents(row.asking_rent_cents)) {
      leasedRents.push(Math.round(row.asking_rent_cents));
    }
    if (
      typeof row.days_on_market === "number" &&
      Number.isFinite(row.days_on_market) &&
      row.days_on_market >= 0
    ) {
      leasedDays.push(Math.floor(row.days_on_market));
    }
  }

  const activeRents: number[] = [];
  for (const row of activeListings) {
    if (row.status != null && row.status !== "available") continue;
    if (!rowMatchesSubject(row, cityKey, beds)) continue;
    if (positiveCents(row.rent_cents)) activeRents.push(Math.round(row.rent_cents));
  }

  const askingRents = [...leasedRents, ...activeRents];
  return {
    sampleSize: askingRents.length,
    leasedSampleSize: leasedRents.length,
    activeListingSampleSize: activeRents.length,
    medianAskingCents:
      askingRents.length >= minSample ? medianCents(askingRents) : null,
    medianDaysOnMarket:
      leasedDays.length >= minSample ? medianNumber(leasedDays) : null,
  };
}

export function suggestRentRange({
  subject,
  benchmarks,
  own,
  config,
}: {
  subject: MarketRentSubject;
  benchmarks: readonly RentBenchmarkRow[];
  own: OwnCompsResult;
  config?: MarketRentConfig;
}): MarketRentSuggestion | null {
  const minSample = sampleFloor(config?.minSample);
  const ownWeight = clamp(config?.ownWeight ?? DEFAULT_MARKET_RENT_CONFIG.ownWeight, 0, 1);
  const spread = clamp(config?.spread ?? DEFAULT_MARKET_RENT_CONFIG.spread, 0, 1);
  const anchor = chooseAnchor(benchmarks, subject);
  const ownMedian =
    own.sampleSize >= minSample && own.medianAskingCents != null
      ? own.medianAskingCents
      : null;

  if (!anchor && ownMedian == null) return null;

  const midCents =
    anchor && ownMedian != null
      ? Math.round(anchor.avg_rent_cents * (1 - ownWeight) + ownMedian * ownWeight)
      : anchor
        ? Math.round(anchor.avg_rent_cents)
        : Math.round(ownMedian ?? 0);
  if (!positiveCents(midCents)) return null;

  const lowCents = Math.min(midCents, Math.round(midCents * (1 - spread)));
  const highCents = Math.max(midCents, Math.round(midCents * (1 + spread)));
  const basis = basisLines({ subject, benchmarks, anchor, own, minSample });

  return {
    lowCents,
    midCents,
    highCents,
    confidence: confidenceFor(anchor, own, minSample),
    anchor: anchor
      ? {
          source: anchor.source,
          unit_class: anchor.unit_class,
          period: anchor.period,
        }
      : null,
    basis,
  };
}

function chooseAnchor(
  benchmarks: readonly RentBenchmarkRow[],
  subject: MarketRentSubject,
): RentBenchmarkRow | null {
  const desired = subject.unitClass ?? "purpose_built";
  return (
    [...benchmarks].sort(
      (a, b) =>
        unitClassScore(a.unit_class, desired) -
          unitClassScore(b.unit_class, desired) ||
        compareBenchmarkRecency(a, b),
    )[0] ?? null
  );
}

function confidenceFor(
  anchor: RentBenchmarkRow | null,
  own: OwnCompsResult,
  minSample: number,
): MarketRentSuggestion["confidence"] {
  const hasOwn = own.sampleSize >= minSample && own.medianAskingCents != null;
  const hasExactAnchor = !!anchor && anchor.unit_class !== "all";
  if (hasExactAnchor && hasOwn) return "high";
  if (hasExactAnchor || hasOwn) return "medium";
  return "low";
}

function basisLines({
  subject,
  benchmarks,
  anchor,
  own,
  minSample,
}: {
  subject: MarketRentSubject;
  benchmarks: readonly RentBenchmarkRow[];
  anchor: RentBenchmarkRow | null;
  own: OwnCompsResult;
  minSample: number;
}): string[] {
  const rows = anchor
    ? [
        anchor,
        ...[...benchmarks]
          .sort(compareBenchmarkRecency)
          .filter((row) => row !== anchor),
      ]
    : [...benchmarks].sort(compareBenchmarkRecency);
  const basis = rows.map(benchmarkBasisLine);
  if (own.sampleSize >= minSample && own.medianAskingCents != null) {
    const city = displayCity(subject.city);
    const sourceLabel =
      own.leasedSampleSize > 0 && own.activeListingSampleSize > 0
        ? "local leases/listings"
        : own.leasedSampleSize > 0
          ? "recent leases"
          : "active listings";
    const dom =
      own.medianDaysOnMarket != null
        ? `, ~${own.medianDaysOnMarket} days to lease`
        : "";
    basis.push(
      `Your ${own.sampleSize} ${sourceLabel} in ${city}: median asking ${formatMoney(
        own.medianAskingCents,
      )}${dom}`,
    );
  }
  return basis;
}

function benchmarkBasisLine(row: RentBenchmarkRow): string {
  return `${row.source} ${row.period}, ${unitClassLabel(row.unit_class)} ${bedLabel(
    row.beds,
  )}, ${row.geography_label}: ${formatMoney(row.avg_rent_cents)}`;
}

function unitClassScore(
  unitClass: BenchmarkUnitClass,
  desired: BenchmarkUnitClass,
): number {
  if (unitClass === desired) return 0;
  if (unitClass === "purpose_built" && desired !== "condo") return 1;
  if (unitClass === "condo") return 2;
  return 3;
}

function rowMatchesSubject(
  row: { city?: string | null; address?: string | null; beds?: number | null },
  cityKey: string,
  beds: number,
): boolean {
  const rowCity = row.city?.trim() ? row.city : cityFromBenchmarkAddress(row.address);
  return normalizeBenchmarkCity(rowCity) === cityKey && normalizeBeds(row.beds) === beds;
}

function positiveCents(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeBeds(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;
  return value;
}

function medianCents(values: readonly number[]): number {
  return Math.round(medianNumber(values));
}

function medianNumber(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function sampleFloor(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_MARKET_RENT_CONFIG.minSample;
  }
  return Math.max(1, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function unitClassLabel(unitClass: BenchmarkUnitClass): string {
  if (unitClass === "purpose_built") return "purpose-built";
  if (unitClass === "condo") return "condo";
  return "all-rental";
}

function bedLabel(beds: number): string {
  if (beds === 0) return "studio";
  return `${beds}-bed`;
}

function displayCity(city: string | null | undefined): string {
  const clean = (city ?? "").trim();
  return clean || "this market";
}

function emptyOwnComps(): OwnCompsResult {
  return {
    sampleSize: 0,
    leasedSampleSize: 0,
    activeListingSampleSize: 0,
    medianAskingCents: null,
    medianDaysOnMarket: null,
  };
}
