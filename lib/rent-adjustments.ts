export const RENT_ADJUSTMENT_KINDS = [
  "original",
  "increase",
  "reduction",
  "altered_term",
  "correction",
] as const;

export const RENT_ADJUSTMENT_SOURCES = [
  "lease_ocr",
  "landlord_confirm",
  "n1",
  "import",
] as const;

export type RentAdjustmentKind = (typeof RENT_ADJUSTMENT_KINDS)[number];
export type RentAdjustmentSource = (typeof RENT_ADJUSTMENT_SOURCES)[number];

export type RentAdjustmentLike = {
  effectiveDate: string;
  rentCents: number;
  createdAt?: string | null;
};

export type ResolvedRentAdjustment = {
  effectiveDate: string;
  rentCents: number;
  kind: RentAdjustmentKind;
  source: RentAdjustmentSource;
  note: string | null;
};

export type RentReconciliationStatus = "unchanged" | "changed";

export type RentReconciliationInput = {
  required: boolean;
  status: string | null;
  leaseStartDate: string | null;
  originalRentCents: number | null;
  currentRentCents: number | null;
  currentEffectiveDate: string | null;
  originalSource?: RentAdjustmentSource;
  optionalAdjustments?: Array<{
    effectiveDate: string | null;
    rentCents: number | null;
    kind: string | null;
    note?: string | null;
  }>;
};

export type ResolvedRentReconciliation = {
  status: RentReconciliationStatus;
  rows: ResolvedRentAdjustment[];
  currentRentCents: number;
  lastIncreaseDate: string | null;
};

export type RentReconciliationResult =
  | { ok: true; reconciliation: ResolvedRentReconciliation | null }
  | { ok: false; code: string };

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isPositiveRent(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isRentAdjustmentKind(value: string | null | undefined): value is RentAdjustmentKind {
  return (RENT_ADJUSTMENT_KINDS as readonly string[]).includes(value ?? "");
}

export function currentEffectiveRent<T extends RentAdjustmentLike>(
  adjustments: T[],
): T | null {
  let current: T | null = null;
  for (const row of adjustments) {
    if (!isIsoDate(row.effectiveDate) || !Number.isFinite(row.rentCents)) {
      continue;
    }
    if (!current) {
      current = row;
      continue;
    }
    if (row.effectiveDate > current.effectiveDate) {
      current = row;
      continue;
    }
    if (row.effectiveDate === current.effectiveDate) {
      const rowCreated = row.createdAt ?? "";
      const currentCreated = current.createdAt ?? "";
      if (rowCreated >= currentCreated) current = row;
    }
  }
  return current;
}

export function inferAdjustmentKind(
  priorRentCents: number,
  nextRentCents: number,
): RentAdjustmentKind {
  if (nextRentCents > priorRentCents) return "increase";
  if (nextRentCents < priorRentCents) return "reduction";
  return "altered_term";
}

export function resolveRentReconciliation(
  input: RentReconciliationInput,
): RentReconciliationResult {
  if (!input.required && !input.status) {
    return { ok: true, reconciliation: null };
  }

  const status = input.status;
  if (status !== "unchanged" && status !== "changed") {
    return { ok: false, code: "current_rent_confirm" };
  }
  if (!isIsoDate(input.leaseStartDate)) {
    return { ok: false, code: "start" };
  }
  if (!isPositiveRent(input.originalRentCents)) {
    return { ok: false, code: "rent" };
  }

  const originalSource = input.originalSource ?? "landlord_confirm";
  const rows: ResolvedRentAdjustment[] = [
    {
      effectiveDate: input.leaseStartDate,
      rentCents: input.originalRentCents,
      kind: "original",
      source: originalSource,
      note: null,
    },
  ];

  if (status === "unchanged") {
    return {
      ok: true,
      reconciliation: {
        status,
        rows,
        currentRentCents: input.originalRentCents,
        lastIncreaseDate: null,
      },
    };
  }

  if (!isPositiveRent(input.currentRentCents)) {
    return { ok: false, code: "current_rent" };
  }
  if (!isIsoDate(input.currentEffectiveDate)) {
    return { ok: false, code: "current_rent_effective" };
  }
  if (input.currentEffectiveDate < input.leaseStartDate) {
    return { ok: false, code: "increase_before_start" };
  }

  for (const optional of input.optionalAdjustments ?? []) {
    const hasAny =
      optional.effectiveDate != null ||
      optional.rentCents != null ||
      (optional.note ?? "").trim() !== "";
    if (!hasAny) continue;
    if (!isIsoDate(optional.effectiveDate) || !isPositiveRent(optional.rentCents)) {
      return { ok: false, code: "current_rent_history" };
    }
    if (
      optional.effectiveDate < input.leaseStartDate ||
      optional.effectiveDate >= input.currentEffectiveDate
    ) {
      return { ok: false, code: "current_rent_history_date" };
    }
    rows.push({
      effectiveDate: optional.effectiveDate,
      rentCents: optional.rentCents,
      kind: isRentAdjustmentKind(optional.kind) && optional.kind !== "original"
        ? optional.kind
        : inferAdjustmentKind(input.originalRentCents, optional.rentCents),
      source: "landlord_confirm",
      note: (optional.note ?? "").trim() || null,
    });
  }

  rows.push({
    effectiveDate: input.currentEffectiveDate,
    rentCents: input.currentRentCents,
    kind: inferAdjustmentKind(input.originalRentCents, input.currentRentCents),
    source: "landlord_confirm",
    note: "Landlord confirmed current effective rent before arming rent-increase tracking.",
  });

  return {
    ok: true,
    reconciliation: {
      status,
      rows,
      currentRentCents: input.currentRentCents,
      lastIncreaseDate: input.currentEffectiveDate,
    },
  };
}
