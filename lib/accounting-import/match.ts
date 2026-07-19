import { normalizeMerchant } from "../categorization-rules";
import type { LedgerRow } from "./freshbooks";

export type MatchableBankTxn = {
  id: string;
  amountCents: number;
  postedOn: string;
  direction: "debit" | "credit";
  merchant: string | null;
  description: string | null;
  triageStatus: string;
};

export type MatchOutcome =
  | {
      rowNo: number;
      kind: "matched";
      transactionId: string;
      alreadyReconciled: boolean;
    }
  | { rowNo: number; kind: "ambiguous"; candidateIds: string[] }
  | { rowNo: number; kind: "unmatched" };

type Candidate = {
  rowNo: number;
  transactionId: string;
  dateDistance: number;
  overlap: number;
  alreadyReconciled: boolean;
};

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(Number(m[1]), month - 1, day));
}

function dayDistance(a: string, b: string): number | null {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return null;
  return Math.abs(Math.round((da.getTime() - db.getTime()) / (24 * 60 * 60 * 1000)));
}

function tokens(value: string | null): Set<string> {
  const normalized = normalizeMerchant(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter((token) => token.length >= 3));
}

function tokenOverlap(row: LedgerRow, txn: MatchableBankTxn): number {
  const left = tokens(row.description);
  const right = tokens([txn.merchant, txn.description].filter(Boolean).join(" "));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap;
}

function sortCandidates(a: Candidate, b: Candidate): number {
  if (a.dateDistance !== b.dateDistance) return a.dateDistance - b.dateDistance;
  if (a.overlap !== b.overlap) return b.overlap - a.overlap;
  return a.transactionId.localeCompare(b.transactionId);
}

export function matchLedgerRows(
  rows: LedgerRow[],
  txns: MatchableBankTxn[],
  opts: { dayWindow?: number } = {},
): MatchOutcome[] {
  const dayWindow = opts.dayWindow ?? 4;
  const candidatesByRow = new Map<number, Candidate[]>();
  const txnsById = new Map(txns.map((txn) => [txn.id, txn]));

  for (const row of rows) {
    const candidates: Candidate[] = [];
    for (const txn of txns) {
      if (txn.amountCents !== row.amountCents || txn.direction !== row.direction) continue;
      const distance = dayDistance(row.date, txn.postedOn);
      if (distance == null || distance > dayWindow) continue;
      candidates.push({
        rowNo: row.rowNo,
        transactionId: txn.id,
        dateDistance: distance,
        overlap: tokenOverlap(row, txn),
        alreadyReconciled: txn.triageStatus !== "pending",
      });
    }
    candidates.sort(sortCandidates);
    candidatesByRow.set(row.rowNo, candidates);
  }

  const outcomes = new Map<number, MatchOutcome>();
  const claimedTxns = new Set<string>();
  const rowOrder = [...rows].sort((a, b) => {
    const ac = candidatesByRow.get(a.rowNo) ?? [];
    const bc = candidatesByRow.get(b.rowNo) ?? [];
    if (ac.length === 0 && bc.length === 0) return a.rowNo - b.rowNo;
    if (ac.length === 0) return 1;
    if (bc.length === 0) return -1;
    return sortCandidates(ac[0], bc[0]) || a.rowNo - b.rowNo;
  });

  for (const row of rowOrder) {
    const available = (candidatesByRow.get(row.rowNo) ?? []).filter(
      (candidate) => !claimedTxns.has(candidate.transactionId),
    );
    if (available.length === 0) {
      outcomes.set(row.rowNo, { rowNo: row.rowNo, kind: "unmatched" });
      continue;
    }

    const [first, second] = available;
    if (
      second &&
      first.dateDistance === second.dateDistance &&
      first.overlap === second.overlap
    ) {
      outcomes.set(row.rowNo, {
        rowNo: row.rowNo,
        kind: "ambiguous",
        candidateIds: available
          .filter(
            (candidate) =>
              candidate.dateDistance === first.dateDistance &&
              candidate.overlap === first.overlap,
          )
          .map((candidate) => candidate.transactionId),
      });
      continue;
    }

    claimedTxns.add(first.transactionId);
    outcomes.set(row.rowNo, {
      rowNo: row.rowNo,
      kind: "matched",
      transactionId: first.transactionId,
      alreadyReconciled: txnsById.get(first.transactionId)?.triageStatus !== "pending",
    });
  }

  return rows.map((row) => outcomes.get(row.rowNo) ?? { rowNo: row.rowNo, kind: "unmatched" });
}
