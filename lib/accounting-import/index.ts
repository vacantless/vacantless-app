import { normalizeMerchant } from "../categorization-rules";
import type { ExpenseCategory } from "../expenses";
import { mapSourceCategory, type MappedDisposition } from "./category-map";
import type { LedgerRow } from "./freshbooks";
import { matchLedgerRows, type MatchableBankTxn, type MatchOutcome } from "./match";

export type PlannedAction =
  | "rule_seed"
  | "direct_expense"
  | "rent_link"
  | "exclude"
  | "needs_review";

export type ImportPropertyRef = {
  id: string;
  address: string;
  name?: string | null;
  buildingKey?: string | null;
};

export type PlanningBankTxn = MatchableBankTxn & {
  merchantEntityId?: string | null;
  streamId?: string | null;
  accountExternalId?: string | null;
};

export type PlannedRow = LedgerRow & {
  match: MatchOutcome;
  mappedDisposition: MappedDisposition;
  matchedTransactionId: string | null;
  alreadyReconciled: boolean;
  plannedAction: PlannedAction;
  plannedCategory: ExpenseCategory | null;
  plannedPropertyId: string | null;
  plannedBuildingKey: string | null;
  needsReviewReason: string | null;
};

type DraftPlannedRow = Omit<PlannedRow, "plannedAction" | "needsReviewReason"> & {
  merchantNorm: string | null;
};

function tokenSet(value: string | null): Set<string> {
  const normalized = normalizeMerchant(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter((token) => token.length >= 2));
}

function scoreProperty(tag: string, property: ImportPropertyRef): number {
  const needle = normalizeMerchant(tag);
  const haystack = normalizeMerchant(
    [property.name, property.address, property.buildingKey].filter(Boolean).join(" "),
  );
  if (!needle || !haystack) return 0;
  if (needle === haystack) return 100;
  if (haystack.includes(needle) || needle.includes(haystack)) return 75;

  const left = tokenSet(needle);
  const right = tokenSet(haystack);
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap;
}

function resolveProperty(
  clientTag: string | null,
  properties: ImportPropertyRef[],
): { propertyId: string | null; buildingKey: string | null } {
  const tag = (clientTag ?? "").trim();
  if (!tag) return { propertyId: null, buildingKey: null };
  const scored = properties
    .map((property) => ({ property, score: scoreProperty(tag, property) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.property.id.localeCompare(b.property.id));
  if (scored.length === 0) return { propertyId: null, buildingKey: null };
  if (scored[1] && scored[1].score === scored[0].score) {
    return { propertyId: null, buildingKey: null };
  }
  return { propertyId: scored[0].property.id, buildingKey: null };
}

function reasonForNonApply(row: DraftPlannedRow): string | null {
  if (row.match.kind === "ambiguous") return "Multiple bank transactions could match.";
  if (row.match.kind === "unmatched") return "No existing bank transaction matched.";
  if (row.alreadyReconciled) return "The matched bank transaction is already reconciled.";
  if (row.mappedDisposition.kind === "unknown") return "Pick the Vacantless category before applying.";
  if (row.mappedDisposition.kind === "rent" && !row.plannedPropertyId) {
    return "Pick the rental this income belongs to.";
  }
  if (row.mappedDisposition.kind === "expense" && !row.plannedPropertyId && !row.plannedBuildingKey) {
    return "Pick the rental or building this expense belongs to.";
  }
  return null;
}

function recurringKey(row: DraftPlannedRow): string | null {
  if (
    row.match.kind !== "matched" ||
    row.alreadyReconciled ||
    row.mappedDisposition.kind !== "expense" ||
    !row.plannedPropertyId ||
    !row.merchantNorm
  ) {
    return null;
  }
  return [row.merchantNorm, row.mappedDisposition.category, row.plannedPropertyId].join("|");
}

export function buildCategorizationImportPlan(
  rows: LedgerRow[],
  txns: PlanningBankTxn[],
  properties: ImportPropertyRef[],
  opts: { dayWindow?: number; ruleSeedThreshold?: number } = {},
): PlannedRow[] {
  const ruleSeedThreshold = opts.ruleSeedThreshold ?? 2;
  const matches = new Map(
    matchLedgerRows(rows, txns, { dayWindow: opts.dayWindow }).map((match) => [match.rowNo, match]),
  );
  const txnsById = new Map(txns.map((txn) => [txn.id, txn]));

  const drafts: DraftPlannedRow[] = rows.map((row) => {
    const match = matches.get(row.rowNo) ?? { rowNo: row.rowNo, kind: "unmatched" as const };
    const matchedTransactionId = match.kind === "matched" ? match.transactionId : null;
    const txn = matchedTransactionId ? txnsById.get(matchedTransactionId) ?? null : null;
    const disposition = mapSourceCategory(row.sourceCategory, row.direction);
    const scope = resolveProperty(row.clientTag, properties);
    return {
      ...row,
      match,
      mappedDisposition: disposition,
      matchedTransactionId,
      alreadyReconciled: match.kind === "matched" ? match.alreadyReconciled : false,
      plannedCategory: disposition.kind === "expense" ? disposition.category : null,
      plannedPropertyId: scope.propertyId,
      plannedBuildingKey: scope.buildingKey,
      merchantNorm: normalizeMerchant([txn?.merchant, txn?.description, row.description].filter(Boolean).join(" ")),
    };
  });

  const recurringCounts = new Map<string, number>();
  for (const draft of drafts) {
    const key = recurringKey(draft);
    if (!key) continue;
    recurringCounts.set(key, (recurringCounts.get(key) ?? 0) + 1);
  }

  return drafts.map((draft) => {
    const nonApplyReason = reasonForNonApply(draft);
    if (nonApplyReason) {
      return { ...draft, plannedAction: "needs_review", needsReviewReason: nonApplyReason };
    }

    if (draft.mappedDisposition.kind === "excluded") {
      return { ...draft, plannedAction: "exclude", needsReviewReason: null };
    }
    if (draft.mappedDisposition.kind === "rent") {
      return { ...draft, plannedAction: "rent_link", needsReviewReason: null };
    }
    if (draft.mappedDisposition.kind === "expense") {
      const key = recurringKey(draft);
      const recurring = key ? (recurringCounts.get(key) ?? 0) >= ruleSeedThreshold : false;
      // Two or more matched rows with the same merchant/category/property get a
      // scoped saved rule; singletons stay direct one-off expenses.
      return {
        ...draft,
        plannedAction: recurring ? "rule_seed" : "direct_expense",
        needsReviewReason: null,
      };
    }

    return {
      ...draft,
      plannedAction: "needs_review",
      needsReviewReason: "Review this row before applying.",
    };
  });
}

export { parseFreshbooksCsv, type LedgerRow, type FreshbooksParseResult } from "./freshbooks";
export { mapSourceCategory, type MappedDisposition } from "./category-map";
export { matchLedgerRows, type MatchableBankTxn, type MatchOutcome } from "./match";
