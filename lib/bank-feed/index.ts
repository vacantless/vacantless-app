// The provider-agnostic bank-feed seam (no I/O) so it can be unit-tested in
// isolation. Run: npx tsx scripts/test-bank-feed.ts
//
// The WHOLE point of this file is the boundary: an aggregator (Plaid for Growth,
// Flinks for Premium) is a swappable adapter behind one BankFeedProvider
// interface, and everything downstream (the staging ledger, the triage UI, the
// expense model) only ever sees a NormalizedTxn and never knows which vendor
// produced it. Build the seam + the Plaid adapter first; the Flinks adapter slots
// in later behind the same interface with zero downstream change.
//
// See VACANTLESS-BANK-FEED-DECISION-2026-06-22.md. The concrete adapters live in
// ./plaid.ts and ./flinks.ts; this file holds the contract + the pure routing /
// normalization helpers that have no vendor or network dependency.

import type { PlanEntitlements } from "../billing";

// --- Normalized shapes (the only thing downstream code sees) ----------------

export type ProviderKey = "plaid" | "flinks";

export type TxnDirection = "debit" | "credit"; // debit = money out = expense candidate

/**
 * One transaction, normalized across providers. `amountCents` is the ABSOLUTE
 * value; the sign lives in `direction` so downstream never has to know a given
 * vendor's sign convention. `rawCategory` is the aggregator's generic category —
 * advisory only, never authoritative for our expense category.
 */
export type NormalizedTxn = {
  externalId: string; // provider txn id — the dedupe key
  accountExternalId: string | null;
  accountName: string | null;
  postedOn: string; // ISO "YYYY-MM-DD"
  amountCents: number; // absolute, integer cents, >= 0
  direction: TxnDirection;
  merchant: string | null;
  description: string | null;
  rawCategory: string | null;
  currency: string; // ISO 4217, e.g. "CAD"
};

export type ConnectedAccount = {
  externalId: string;
  name: string | null;
  mask: string | null; // last 4, display only
  type: string | null; // depository / credit / loan ... (vendor string)
};

/** The handoff a provider returns to start the client connect flow. */
export type ConnectHandoff = {
  provider: ProviderKey;
  // Plaid: link_token; Flinks: the connect/iframe URL or session token.
  token: string;
  expiresAt?: string | null;
};

export type BankConnectionStatus =
  | "active"
  | "reauth_required"
  | "disconnected"
  | "error";

// --- The contract every adapter implements ----------------------------------

export interface BankFeedProvider {
  readonly key: ProviderKey;
  /** Begin a connect flow; returns the client handoff token. */
  startConnect(orgId: string): Promise<ConnectHandoff>;
  /** Exchange the public/connect token for a durable connection + access token. */
  completeConnect(
    publicToken: string,
  ): Promise<{ externalId: string; accessToken: string; institutionName: string | null }>;
  /** List the accounts under a connection. */
  listAccounts(accessToken: string): Promise<ConnectedAccount[]>;
  /** Pull transactions on/after `sinceIso`, already normalized. */
  pullTransactions(accessToken: string, sinceIso: string): Promise<NormalizedTxn[]>;
}

// --- Provider routing (pure) ------------------------------------------------
//
// Tiers are a SUPERSET: a higher tier gets everything the lower tier has PLUS
// more. Every paid-feed tier (Growth+) gets Plaid; Premium ADDS Flinks on top —
// it does NOT lose Plaid. So a Premium org can run connections on either rail.
// Driven entirely by the plan entitlements (lib/billing PLAN_ENTITLEMENTS): the
// `bank_feed` flag = "has the Plaid rail", `accounting` = "Premium, also gets
// Flinks". Free / unentitled = no live feed (CSV import only).

/**
 * All aggregator rails a plan is entitled to, lowest-to-highest. Growth = [plaid];
 * Premium = [plaid, flinks] (superset). Empty = no live feed.
 */
export function availableProviders(entitlements: PlanEntitlements): ProviderKey[] {
  const out: ProviderKey[] = [];
  if (entitlements.bank_feed || entitlements.accounting) out.push("plaid");
  if (entitlements.accounting) out.push("flinks"); // Premium-only addition
  return out;
}

/**
 * The DEFAULT rail for a NEW connection. Plaid is the built/default rail for every
 * entitled tier today; Premium also has Flinks available (see availableProviders),
 * and once the Flinks adapter ships (Slice 6) Premium's default can prefer it while
 * keeping Plaid. Returns null when the plan has no live feed.
 */
export function providerForPlan(entitlements: PlanEntitlements): ProviderKey | null {
  return availableProviders(entitlements).length > 0 ? "plaid" : null;
}

/** True when the org may use a LIVE aggregator feed (vs. CSV import only). */
export function hasLiveBankFeed(entitlements: PlanEntitlements): boolean {
  return availableProviders(entitlements).length > 0;
}

// --- Normalization helpers (pure) -------------------------------------------

/**
 * Normalize a signed minor-unit amount into { amountCents, direction }. Each
 * adapter calls this so the sign convention is decided in ONE place. `outflowSign`
 * says which sign of the RAW amount means money LEAVING the account: Plaid uses
 * positive = outflow, most others use negative = outflow. Returns absolute cents.
 */
export function normalizeAmount(
  rawAmountCents: number,
  outflowSign: 1 | -1,
): { amountCents: number; direction: TxnDirection } {
  const isOutflow = outflowSign === 1 ? rawAmountCents > 0 : rawAmountCents < 0;
  return {
    amountCents: Math.abs(Math.trunc(rawAmountCents)),
    direction: isOutflow ? "debit" : "credit",
  };
}

/** A transaction is an expense candidate iff it is money LEAVING the account. */
export function isExpenseCandidate(txn: Pick<NormalizedTxn, "direction">): boolean {
  return txn.direction === "debit";
}

/** The dedupe key for a transaction within a connection. */
export function dedupeKey(connectionId: string, externalId: string): string {
  return `${connectionId}:${externalId}`;
}

/**
 * Filter a freshly-pulled batch down to transactions not already staged, by
 * external id. `existingExternalIds` is the set already in bank_transactions for
 * the connection. Pure — the caller supplies the known set and persists the
 * result. Guards the (connection_id, external_id) uniqueness before the insert so
 * a re-sync is idempotent rather than relying on a DB conflict.
 */
export function filterNewTransactions(
  pulled: NormalizedTxn[],
  existingExternalIds: ReadonlySet<string>,
): NormalizedTxn[] {
  const seen = new Set<string>();
  const out: NormalizedTxn[] = [];
  for (const t of pulled) {
    if (existingExternalIds.has(t.externalId)) continue;
    if (seen.has(t.externalId)) continue; // de-dupe within the batch too
    seen.add(t.externalId);
    out.push(t);
  }
  return out;
}
