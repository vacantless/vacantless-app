import type { NormalizedTxn, TxnDirection } from "./bank-feed";

export type ReconciliationTriageStatus =
  | "pending"
  | "assigned"
  | "ignored"
  | "rent"
  | "excluded"
  | string;

export type BankTransactionForReconciliation = {
  id: string;
  accountExternalId: string | null;
  accountName: string | null;
  postedOn: string;
  amountCents: number;
  direction: TxnDirection;
  merchant?: string | null;
  description?: string | null;
  currency?: string | null;
  triageStatus: ReconciliationTriageStatus;
  expenseId: string | null;
};

export type ExpenseReconciliationLink = {
  id: string;
  bankTransactionId: string | null;
  category?: string | null;
};

export type RentPaymentReconciliationLink = {
  id: string;
  bankTransactionId: string | null;
  tenancyId: string | null;
  amountCents: number;
  periodMonth?: string | null;
  label?: string | null;
};

export type ReconciliationState =
  | {
      kind: "expense";
      reconciled: true;
      label: string;
      expenseId: string;
    }
  | {
      kind: "rent";
      reconciled: true;
      label: string;
      rentPaymentIds: string[];
    }
  | {
      kind: "excluded";
      reconciled: true;
      label: string;
    }
  | {
      kind: "unreconciled";
      reconciled: false;
      label: string;
    };

export type ReconciledTransaction = BankTransactionForReconciliation & {
  state: ReconciliationState;
  signedAmountCents: number;
  runningBalanceCents: number;
};

export type AccountReconciliation = {
  key: string;
  label: string;
  balanceCents: number;
  unreconciledCount: number;
  unreconciledCents: number;
  transactions: ReconciledTransaction[];
};

export type ReconciliationSummary = {
  accounts: AccountReconciliation[];
  totalBalanceCents: number;
  unreconciledCount: number;
  unreconciledCents: number;
};

export type RentMatchTenancy = {
  tenancyId: string;
  rentCents: number | null;
  label?: string | null;
  propertyId?: string | null;
};

export type RentMatchCandidate = {
  tenancyId: string;
  label: string;
  rentCents: number;
  differenceCents: number;
  confidence: "exact" | "near";
};

export type ExpenseMatchCandidate = {
  category: string;
  propertyId: string | null;
  buildingKey: string | null;
  confidence: "rule" | "fallback";
};

export function signedTransactionAmountCents(
  txn: Pick<BankTransactionForReconciliation, "amountCents" | "direction">,
): number {
  return txn.direction === "credit" ? txn.amountCents : -txn.amountCents;
}

export function accountKeyForTransaction(
  txn: Pick<BankTransactionForReconciliation, "accountExternalId" | "accountName">,
): string {
  const external = (txn.accountExternalId ?? "").trim();
  if (external) return `external:${external}`;
  const name = (txn.accountName ?? "").trim();
  if (name) return `name:${name.toLowerCase()}`;
  return "unknown";
}

export function accountLabelForTransaction(
  txn: Pick<BankTransactionForReconciliation, "accountExternalId" | "accountName">,
): string {
  return txn.accountName?.trim() || txn.accountExternalId?.trim() || "Unlabelled account";
}

function expenseLabel(expense: ExpenseReconciliationLink | undefined): string {
  if (!expense?.category) return "Matched expense";
  return `Matched expense - ${expense.category.replace(/_/g, " ")}`;
}

function rentLabel(payments: RentPaymentReconciliationLink[]): string {
  if (payments.length === 1) {
    const p = payments[0];
    return p.label ? `Matched rent - ${p.label}` : "Matched rent";
  }
  return `Matched rent - ${payments.length} payments`;
}

export function deriveReconciliationState(
  txn: BankTransactionForReconciliation,
  links: {
    expensesByTransactionId?: ReadonlyMap<string, ExpenseReconciliationLink>;
    rentPaymentsByTransactionId?: ReadonlyMap<string, RentPaymentReconciliationLink[]>;
  } = {},
): ReconciliationState {
  if (txn.direction === "debit") {
    const expense = links.expensesByTransactionId?.get(txn.id);
    if (txn.expenseId || expense) {
      return {
        kind: "expense",
        reconciled: true,
        label: expenseLabel(expense),
        expenseId: txn.expenseId ?? expense?.id ?? "",
      };
    }
  }

  if (txn.direction === "credit") {
    const payments = links.rentPaymentsByTransactionId?.get(txn.id) ?? [];
    if (payments.length > 0) {
      return {
        kind: "rent",
        reconciled: true,
        label: rentLabel(payments),
        rentPaymentIds: payments.map((p) => p.id),
      };
    }
  }

  if (txn.triageStatus === "ignored" || txn.triageStatus === "excluded") {
    return {
      kind: "excluded",
      reconciled: true,
      label: txn.direction === "credit" ? "Excluded income" : "Excluded spend",
    };
  }

  return {
    kind: "unreconciled",
    reconciled: false,
    label: txn.direction === "credit" ? "Unmatched income" : "Unmatched spend",
  };
}

export function mapExpensesByTransactionId(
  expenses: ExpenseReconciliationLink[],
): Map<string, ExpenseReconciliationLink> {
  const out = new Map<string, ExpenseReconciliationLink>();
  for (const expense of expenses) {
    if (!expense.bankTransactionId) continue;
    out.set(expense.bankTransactionId, expense);
  }
  return out;
}

export function mapRentPaymentsByTransactionId(
  payments: RentPaymentReconciliationLink[],
): Map<string, RentPaymentReconciliationLink[]> {
  const out = new Map<string, RentPaymentReconciliationLink[]>();
  for (const payment of payments) {
    if (!payment.bankTransactionId) continue;
    const list = out.get(payment.bankTransactionId) ?? [];
    list.push(payment);
    out.set(payment.bankTransactionId, list);
  }
  return out;
}

export function buildReconciliationSummary(
  transactions: BankTransactionForReconciliation[],
  links: {
    expenses?: ExpenseReconciliationLink[];
    rentPayments?: RentPaymentReconciliationLink[];
  } = {},
): ReconciliationSummary {
  const expensesByTransactionId = mapExpensesByTransactionId(links.expenses ?? []);
  const rentPaymentsByTransactionId = mapRentPaymentsByTransactionId(links.rentPayments ?? []);
  const byAccount = new Map<string, BankTransactionForReconciliation[]>();

  for (const txn of transactions) {
    const key = accountKeyForTransaction(txn);
    byAccount.set(key, [...(byAccount.get(key) ?? []), txn]);
  }

  const accounts: AccountReconciliation[] = [];
  for (const [key, txns] of byAccount.entries()) {
    const chronological = [...txns].sort((a, b) => {
      const date = a.postedOn.localeCompare(b.postedOn);
      return date !== 0 ? date : a.id.localeCompare(b.id);
    });

    let balanceCents = 0;
    let unreconciledCount = 0;
    let unreconciledCents = 0;
    const withRunning: ReconciledTransaction[] = [];

    for (const txn of chronological) {
      balanceCents += signedTransactionAmountCents(txn);
      const state = deriveReconciliationState(txn, {
        expensesByTransactionId,
        rentPaymentsByTransactionId,
      });
      if (!state.reconciled) {
        unreconciledCount += 1;
        unreconciledCents += txn.amountCents;
      }
      withRunning.push({
        ...txn,
        state,
        signedAmountCents: signedTransactionAmountCents(txn),
        runningBalanceCents: balanceCents,
      });
    }

    accounts.push({
      key,
      label: accountLabelForTransaction(txns[0]),
      balanceCents,
      unreconciledCount,
      unreconciledCents,
      transactions: withRunning.sort((a, b) => {
        const date = b.postedOn.localeCompare(a.postedOn);
        return date !== 0 ? date : b.id.localeCompare(a.id);
      }),
    });
  }

  accounts.sort((a, b) => {
    if (b.unreconciledCount !== a.unreconciledCount) {
      return b.unreconciledCount - a.unreconciledCount;
    }
    return a.label.localeCompare(b.label);
  });

  return {
    accounts,
    totalBalanceCents: accounts.reduce((sum, account) => sum + account.balanceCents, 0),
    unreconciledCount: accounts.reduce((sum, account) => sum + account.unreconciledCount, 0),
    unreconciledCents: accounts.reduce((sum, account) => sum + account.unreconciledCents, 0),
  };
}

export function rentMatchCandidatesForTransaction(
  txn: Pick<BankTransactionForReconciliation, "amountCents" | "direction">,
  tenancies: RentMatchTenancy[],
  options: { toleranceCents?: number; toleranceRatio?: number } = {},
): RentMatchCandidate[] {
  if (txn.direction !== "credit") return [];

  const fixedTolerance = options.toleranceCents ?? 500;
  const ratio = options.toleranceRatio ?? 0.02;
  const out: RentMatchCandidate[] = [];

  for (const tenancy of tenancies) {
    const rentCents = tenancy.rentCents;
    if (rentCents == null || rentCents <= 0) continue;
    const differenceCents = Math.abs(txn.amountCents - rentCents);
    const tolerance = Math.max(fixedTolerance, Math.round(rentCents * ratio));
    if (differenceCents > tolerance) continue;
    out.push({
      tenancyId: tenancy.tenancyId,
      label: tenancy.label || "Tenancy",
      rentCents,
      differenceCents,
      confidence: differenceCents === 0 ? "exact" : "near",
    });
  }

  return out.sort((a, b) => {
    if (a.differenceCents !== b.differenceCents) {
      return a.differenceCents - b.differenceCents;
    }
    return a.label.localeCompare(b.label);
  });
}

export function expenseMatchCandidateForTransaction(
  txn: Pick<BankTransactionForReconciliation, "direction">,
  suggestion?: {
    category?: string | null;
    propertyId?: string | null;
    buildingKey?: string | null;
  } | null,
): ExpenseMatchCandidate | null {
  if (txn.direction !== "debit") return null;
  return {
    category: suggestion?.category || "other",
    propertyId: suggestion?.propertyId ?? null,
    buildingKey: suggestion?.buildingKey ?? null,
    confidence: suggestion ? "rule" : "fallback",
  };
}

export function isReimportNoop(
  pulled: NormalizedTxn[],
  existingExternalIds: ReadonlySet<string>,
): boolean {
  for (const txn of pulled) {
    if (!existingExternalIds.has(txn.externalId)) return false;
  }
  return true;
}
