import { averageKnownDays } from "@/lib/reports";

const DAY_MS = 24 * 60 * 60 * 1000;

export type VacancyCostUnit = {
  id?: string;
  status?: string | null;
  rentCents?: number | null;
  availableSince?: string | Date | null;
  daysOnMarket?: number | null;
};

export type VacancyUnitModel = {
  id?: string;
  isVacant: boolean;
  days: number | null;
  lostCents: number | null;
};

export type VacancyPortfolioModel = {
  vacantUnits: number;
  knownVacantUnits: number;
  unknownVacantUnits: number;
  totalLostCents: number | null;
  timeToLease: { averageDays: number | null; sampleSize: number };
};

export type VacancyStripModel = {
  units: VacancyUnitModel[];
  portfolio: VacancyPortfolioModel;
};

function timeMs(value: string | Date | number): number | null {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function daysVacant({
  status,
  availableSince,
  now,
}: {
  status: string | null | undefined;
  availableSince: string | Date | null | undefined;
  now: string | Date | number;
}): number | null {
  if ((status ?? "").toLowerCase() !== "available") return null;
  if (availableSince == null) return null;
  const startMs = timeMs(availableSince);
  const nowMs = timeMs(now);
  if (startMs == null || nowMs == null) return null;
  return Math.max(0, Math.floor((nowMs - startMs) / DAY_MS));
}

export function dollarsLostSoFar({
  rentCents,
  days,
}: {
  rentCents: number | null | undefined;
  days: number | null | undefined;
}): number | null {
  if (rentCents == null || days == null) return null;
  // One daily-rate definition for vacancy ROI: asking monthly rent divided by 30.
  return Math.round((rentCents / 30) * days);
}

export function portfolioTimeToLease(
  units: readonly Pick<VacancyCostUnit, "daysOnMarket">[],
): { averageDays: number | null; sampleSize: number } {
  return averageKnownDays(units.map((u) => u.daysOnMarket));
}

export function vacancyStripModel(
  units: readonly VacancyCostUnit[],
  now: string | Date | number,
): VacancyStripModel {
  const unitModels = units.map((unit) => {
    const days = daysVacant({
      status: unit.status,
      availableSince: unit.availableSince,
      now,
    });
    return {
      id: unit.id,
      isVacant: (unit.status ?? "").toLowerCase() === "available",
      days,
      lostCents: dollarsLostSoFar({ rentCents: unit.rentCents, days }),
    };
  });
  const vacantUnits = unitModels.filter((u) => u.isVacant);
  const knownLost = vacantUnits
    .map((u) => u.lostCents)
    .filter((c): c is number => c != null);

  return {
    units: unitModels,
    portfolio: {
      vacantUnits: vacantUnits.length,
      knownVacantUnits: vacantUnits.filter((u) => u.days != null).length,
      unknownVacantUnits: vacantUnits.filter((u) => u.days == null).length,
      totalLostCents:
        knownLost.length === 0 ? null : knownLost.reduce((sum, c) => sum + c, 0),
      timeToLease: portfolioTimeToLease(units),
    },
  };
}
