import { normalizePeriodMonth } from "./payments";
import {
  rentMatchCandidatesForTransaction,
  type RentMatchCandidate,
  type RentMatchTenancy,
} from "./reconciliation";

export type RentClassification = "rail" | "likely_rent" | "possible_offcycle" | "not_rent";

export type RentClassifierConfig = {
  dueDay?: number;
  processingBusinessDays?: number;
  railIdentifiers?: readonly string[];
};

export type CreditForRentClassification = {
  amountCents: number;
  postedOn: string;
  description?: string | null;
  source?: string | null;
};

export type CreditRentClassification = {
  railHit: boolean;
  amountCandidates: RentMatchCandidate[];
  inRentWindow: boolean;
  cleanDescription: boolean;
  classification: RentClassification;
  suggestRent: boolean;
};

export type RailRentPaymentForLink = {
  id: string;
  tenancyId: string | null;
  amountCents: number;
  periodMonth: string | null;
  source: string | null;
  bankTransactionId: string | null;
};

export type RailRentPaymentLinkCandidate = {
  paymentId: string;
  tenancyId: string;
  label: string;
  source: string;
  amountCents: number;
  periodMonth: string;
};

export const DEFAULT_RENT_CLASSIFIER_CONFIG = {
  dueDay: 1,
  processingBusinessDays: 5,
  railIdentifiers: ["rotessa", "stripe"],
} as const;

const NON_RENT_PATTERNS = [
  /\bgovernment\b/,
  /\bbenefits?\b/,
  /\bfed[\s-]?prov\b/,
  /\bfed[\s-]?prov\/terr\b/,
  /\bcanada essentials?\b/,
  /\brefund(?:ed)?\b/,
  /\bpaypal\b/,
  /\binsurance\b/,
  /\bentente\b/,
  /\bonline banking\b.*\btransfer\b/,
  /\binvestment transfer\b/,
  /\btransfer\s+(?:to|out|between)\b/,
  /\binterac\s+e-?transfer\s+to\b/,
  /\binteractive brokers?\b/,
];

function configWithDefaults(config: RentClassifierConfig = {}) {
  return {
    dueDay: config.dueDay ?? DEFAULT_RENT_CLASSIFIER_CONFIG.dueDay,
    processingBusinessDays:
      config.processingBusinessDays ?? DEFAULT_RENT_CLASSIFIER_CONFIG.processingBusinessDays,
    railIdentifiers: config.railIdentifiers ?? DEFAULT_RENT_CLASSIFIER_CONFIG.railIdentifiers,
  };
}

function textForCredit(credit: CreditForRentClassification): string {
  return [credit.description, credit.source]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function parseIsoDay(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

function isoFromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dueDateForPostedMonth(postedOn: string, dueDay: number): string | null {
  const parsed = parseIsoDay(postedOn);
  if (!parsed) return null;
  const daysInMonth = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.floor(dueDay)), daysInMonth);
  return isoFromUtcDate(new Date(Date.UTC(parsed.year, parsed.month - 1, day)));
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// Holidays are intentionally out of scope for this first pass; the helper only
// skips Saturdays and Sundays so tests stay deterministic without a holiday DB.
export function addBusinessDaysIso(iso: string, days: number): string | null {
  const parsed = parseIsoDay(iso);
  if (!parsed) return null;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) remaining -= 1;
  }
  return isoFromUtcDate(date);
}

export function isInRentWindow(
  postedOn: string,
  config: RentClassifierConfig = {},
): boolean {
  const cfg = configWithDefaults(config);
  const posted = parseIsoDay(postedOn);
  if (!posted) return false;
  const postedIso = isoFromUtcDate(new Date(Date.UTC(posted.year, posted.month - 1, posted.day)));
  const start = dueDateForPostedMonth(postedIso, cfg.dueDay);
  const end = start ? addBusinessDaysIso(start, cfg.processingBusinessDays) : null;
  return !!start && !!end && postedIso >= start && postedIso <= end;
}

export function hasCleanRentDescription(credit: CreditForRentClassification): boolean {
  const text = textForCredit(credit);
  if (!text) return true;
  return !NON_RENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasRailIdentifier(
  credit: CreditForRentClassification,
  config: RentClassifierConfig = {},
): boolean {
  const cfg = configWithDefaults(config);
  const text = textForCredit(credit);
  if (!text) return false;
  return cfg.railIdentifiers.some((identifier) => {
    const needle = identifier.trim().toLowerCase();
    return needle.length > 0 && text.includes(needle);
  });
}

export function classifyCredit(
  credit: CreditForRentClassification,
  tenancies: RentMatchTenancy[],
  config: RentClassifierConfig = {},
): CreditRentClassification {
  const railHit = hasRailIdentifier(credit, config);
  const amountCandidates = rentMatchCandidatesForTransaction(
    { amountCents: credit.amountCents, direction: "credit" },
    tenancies,
  );
  const inRentWindow = isInRentWindow(credit.postedOn, config);
  const cleanDescription = hasCleanRentDescription(credit);

  let classification: RentClassification = "not_rent";
  if (railHit) {
    classification = "rail";
  } else if (amountCandidates.length > 0 && inRentWindow && cleanDescription) {
    classification = "likely_rent";
  } else if (amountCandidates.length > 0 && !inRentWindow) {
    classification = "possible_offcycle";
  }

  return {
    railHit,
    amountCandidates,
    inRentWindow,
    cleanDescription,
    classification,
    suggestRent: classification === "likely_rent",
  };
}

export function railPaymentLinkCandidatesForTransaction(
  credit: CreditForRentClassification,
  tenancies: RentMatchTenancy[],
  payments: RailRentPaymentForLink[],
  config: RentClassifierConfig = {},
): RailRentPaymentLinkCandidate[] {
  const cfg = configWithDefaults(config);
  const classification = classifyCredit(credit, tenancies, cfg);
  const periodMonth = normalizePeriodMonth(credit.postedOn);
  if (!classification.railHit || !periodMonth || classification.amountCandidates.length === 0) {
    return [];
  }

  const candidateLabels = new Map(
    classification.amountCandidates.map((candidate) => [candidate.tenancyId, candidate.label]),
  );
  const railSources = new Set(cfg.railIdentifiers.map((source) => source.toLowerCase()));
  const out: RailRentPaymentLinkCandidate[] = [];

  for (const payment of payments) {
    const tenancyId = payment.tenancyId ?? "";
    const source = (payment.source ?? "").toLowerCase();
    if (!tenancyId || !candidateLabels.has(tenancyId)) continue;
    if (!railSources.has(source)) continue;
    if (payment.bankTransactionId) continue;
    if (payment.amountCents !== credit.amountCents) continue;
    if (payment.periodMonth !== periodMonth) continue;
    out.push({
      paymentId: payment.id,
      tenancyId,
      label: candidateLabels.get(tenancyId) ?? "Tenancy",
      source,
      amountCents: payment.amountCents,
      periodMonth,
    });
  }

  return out.sort((a, b) => {
    const label = a.label.localeCompare(b.label);
    return label !== 0 ? label : a.source.localeCompare(b.source);
  });
}
