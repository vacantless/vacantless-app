// Pure categorization-rules engine (no I/O) so it can be unit-tested in
// isolation. Run: npx tsx scripts/test-categorization-rules.ts
//
// A categorization_rule (migration 0059) is the owner's saved "remember this"
// decision: when they triage a bank debit and tick "remember", we store how to
// categorize future matching transactions — the FreshBooks "Apply to future
// expenses" pattern. This file is the matching brain: normalize a merchant, test
// a rule against a transaction, rank competing rules by specificity, validate a
// rule submission, and draft a rule from a triage assignment. The I/O (read
// rules, write a rule, auto-file on sync) lives in the expenses actions.
//
// Design: a rule is COMPOSITE + drift-tolerant. Identity keys (>= 1): the Plaid
// recurring stream_id (strongest — Plaid pre-groups each recurring bill so the
// same vendor across many properties stays distinct), the stable
// merchant_entity_id, or a normalized merchant name. Narrowers (optional):
// account, an inclusive amount band, a day-of-month window. Matching = every
// NON-NULL field on the rule must equal the transaction's; absent fields are
// ignored. More satisfied constraints = more specific = wins.

import { isExpenseCategory, type ExpenseCategory } from "./expenses";

// --- Shapes -----------------------------------------------------------------

export type RuleScopeKind = "merchant" | "stream";

/** A stored rule (the matching-relevant subset of the DB row). */
export type CategorizationRule = {
  id?: string;
  scopeKind: RuleScopeKind;
  merchantEntityId: string | null;
  streamId: string | null;
  merchantNorm: string | null;
  accountExternalId: string | null;
  amountMinCents: number | null;
  amountMaxCents: number | null;
  dayMin: number | null;
  dayMax: number | null;
  category: string;
  propertyId: string | null;
  buildingKey: string | null;
  lastAppliedAt?: string | null;
  createdAt?: string | null;
};

/** The transaction fields a rule is matched against. */
export type MatchableTxn = {
  merchantEntityId: string | null;
  streamId: string | null;
  merchant: string | null;
  accountExternalId: string | null;
  amountCents: number;
  postedOn: string; // ISO "YYYY-MM-DD"
};

// --- Merchant normalization -------------------------------------------------

/**
 * Normalize a merchant/description string for fuzzy-stable matching: lowercase,
 * drop everything but letters+digits+spaces, collapse whitespace. So "FACEBK
 * *YK0N-FUM2L2" and "Facebook" both reduce toward a comparable token. Returns
 * null for empty input. Deliberately simple — it's the credential-free fallback,
 * below merchant_entity_id and stream_id in the matching hierarchy.
 */
export function normalizeMerchant(raw: string | null | undefined): string | null {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s === "" ? null : s;
}

/** Day-of-month (1..31) of an ISO date, or null if unparseable. */
function dayOfMonth(iso: string): number | null {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const d = parseInt(m[1], 10);
  return d >= 1 && d <= 31 ? d : null;
}

// --- Matching ---------------------------------------------------------------

/**
 * Does this rule match this transaction? Every NON-NULL field on the rule must
 * equal the transaction's corresponding value; null fields are wildcards. A rule
 * is only meaningful with at least one identity key — validateRuleInput enforces
 * that on write, and a rule with no identity key here matches nothing.
 */
export function ruleMatchesTxn(rule: CategorizationRule, txn: MatchableTxn): boolean {
  const hasIdentity =
    rule.streamId != null || rule.merchantEntityId != null || rule.merchantNorm != null;
  if (!hasIdentity) return false;

  if (rule.streamId != null && rule.streamId !== txn.streamId) return false;
  if (rule.merchantEntityId != null && rule.merchantEntityId !== txn.merchantEntityId) return false;
  if (rule.merchantNorm != null && rule.merchantNorm !== normalizeMerchant(txn.merchant)) return false;

  if (rule.accountExternalId != null && rule.accountExternalId !== txn.accountExternalId) return false;
  if (rule.amountMinCents != null && txn.amountCents < rule.amountMinCents) return false;
  if (rule.amountMaxCents != null && txn.amountCents > rule.amountMaxCents) return false;

  if (rule.dayMin != null || rule.dayMax != null) {
    const d = dayOfMonth(txn.postedOn);
    if (d == null) return false;
    if (rule.dayMin != null && d < rule.dayMin) return false;
    if (rule.dayMax != null && d > rule.dayMax) return false;
  }
  return true;
}

/**
 * A specificity score so the MOST specific matching rule wins when several match.
 * Identity keys are weighted (stream strongest, then merchant_entity, then the
 * name fallback); each narrower adds 1. Higher = more specific.
 */
export function ruleSpecificity(rule: CategorizationRule): number {
  let score = 0;
  if (rule.streamId != null) score += 100;
  if (rule.merchantEntityId != null) score += 50;
  if (rule.merchantNorm != null) score += 10;
  if (rule.accountExternalId != null) score += 1;
  if (rule.amountMinCents != null) score += 1;
  if (rule.amountMaxCents != null) score += 1;
  if (rule.dayMin != null) score += 1;
  if (rule.dayMax != null) score += 1;
  return score;
}

/**
 * The single best rule for a transaction: among matching rules, the most
 * specific; ties broken by most-recently applied, then most-recently created.
 * Returns null when nothing matches.
 */
export function bestRuleForTxn(
  rules: CategorizationRule[],
  txn: MatchableTxn,
): CategorizationRule | null {
  let best: CategorizationRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!ruleMatchesTxn(r, txn)) continue;
    const score = ruleSpecificity(r);
    if (score > bestScore) {
      best = r;
      bestScore = score;
      continue;
    }
    if (score === bestScore && best) {
      const a = (r.lastAppliedAt ?? r.createdAt ?? "") as string;
      const b = (best.lastAppliedAt ?? best.createdAt ?? "") as string;
      if (a > b) best = r;
    }
  }
  return best;
}

/** A scoped rule auto-files an expense on sync; a category-only rule pre-fills. */
export function ruleAutoFiles(rule: CategorizationRule): boolean {
  return rule.propertyId != null || rule.buildingKey != null;
}

// --- The assignment a matched rule produces ---------------------------------

export type RuleAssignment = {
  category: ExpenseCategory;
  propertyId: string | null;
  buildingKey: string | null;
};

/** Resolve what a matched rule should apply to a transaction. */
export function resolveRuleAssignment(rule: CategorizationRule): RuleAssignment {
  const category = isExpenseCategory(rule.category) ? rule.category : "other";
  return { category, propertyId: rule.propertyId, buildingKey: rule.buildingKey };
}

// --- Validation -------------------------------------------------------------

export type RuleInput = {
  scopeKind?: string;
  merchantEntityId?: string | null;
  streamId?: string | null;
  merchantNorm?: string | null;
  accountExternalId?: string | null;
  amountMinCents?: number | null;
  amountMaxCents?: number | null;
  dayMin?: number | null;
  dayMax?: number | null;
  category?: string;
  propertyId?: string | null;
  buildingKey?: string | null;
};

export type RuleValidation =
  | { ok: true; value: CategorizationRule }
  | { ok: false; code: "scope_kind" | "identity" | "category" | "scope" | "band" };

function nz(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}
function ni(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.trunc(v);
}

/**
 * Validate a rule submission. Mirrors the DB CHECKs so a row can never violate
 * them from the app: scope_kind known; >= 1 identity key; category known; scope
 * at most one level (unit XOR building); amount band ordered.
 */
export function validateRuleInput(input: RuleInput): RuleValidation {
  const scopeKind = (input.scopeKind ?? "").trim();
  if (scopeKind !== "merchant" && scopeKind !== "stream") return { ok: false, code: "scope_kind" };

  const merchantEntityId = nz(input.merchantEntityId);
  const streamId = nz(input.streamId);
  const merchantNorm = nz(input.merchantNorm);
  if (merchantEntityId == null && streamId == null && merchantNorm == null) {
    return { ok: false, code: "identity" };
  }

  const rawCat = (input.category ?? "").trim();
  const category = rawCat === "" ? "other" : rawCat;
  if (!isExpenseCategory(category)) return { ok: false, code: "category" };

  const propertyId = nz(input.propertyId);
  const buildingKey = nz(input.buildingKey);
  if (propertyId != null && buildingKey != null) return { ok: false, code: "scope" };

  const amountMinCents = ni(input.amountMinCents);
  const amountMaxCents = ni(input.amountMaxCents);
  if (amountMinCents != null && amountMaxCents != null && amountMinCents > amountMaxCents) {
    return { ok: false, code: "band" };
  }

  return {
    ok: true,
    value: {
      scopeKind,
      merchantEntityId,
      streamId,
      merchantNorm,
      accountExternalId: nz(input.accountExternalId),
      amountMinCents,
      amountMaxCents,
      dayMin: ni(input.dayMin),
      dayMax: ni(input.dayMax),
      category,
      propertyId,
      buildingKey,
    },
  };
}

// --- Drafting a rule from a triage assignment -------------------------------

/** The transaction context available when the owner assigns + ticks "remember". */
export type AssignmentContext = {
  merchantEntityId: string | null;
  streamId: string | null;
  merchant: string | null;
  accountExternalId: string | null;
  amountCents: number;
};

export type AssignmentChoice = {
  scopeKind: RuleScopeKind;
  category: string;
  propertyId?: string | null;
  buildingKey?: string | null;
  /** Optional ± tolerance (cents) to build an amount band around the txn amount
   * when keying a 'stream' rule without a Plaid stream_id. Default 0 = exact. */
  amountToleranceCents?: number;
};

/**
 * Build a RuleInput from a triage assignment + the owner's "remember" choice.
 *
 *   'merchant' → broad "always categorize <merchant> as <category>": keys on
 *      merchant_entity_id when available, else the normalized name; category
 *      only, NO property (so it pre-fills but never mis-files a unit).
 *   'stream'   → "always file THIS recurring charge to <unit/building>": keys on
 *      the Plaid stream_id when available; else falls back to merchant_entity_id
 *      (or name) NARROWED by account + an amount band, so one Rogers plan doesn't
 *      capture the other three. Carries the chosen scope + category.
 *
 * Returns null when there isn't enough signal to make a meaningful rule.
 */
export function draftRuleFromAssignment(
  ctx: AssignmentContext,
  choice: AssignmentChoice,
): RuleInput | null {
  const merchantNorm = normalizeMerchant(ctx.merchant);
  const hasAnyIdentity = ctx.merchantEntityId != null || ctx.streamId != null || merchantNorm != null;
  if (!hasAnyIdentity) return null;

  if (choice.scopeKind === "merchant") {
    // Broad rule: identity only (prefer the stable id; else the name). No scope.
    return {
      scopeKind: "merchant",
      merchantEntityId: ctx.merchantEntityId,
      streamId: null,
      merchantNorm: ctx.merchantEntityId != null ? null : merchantNorm,
      category: choice.category,
      propertyId: null,
      buildingKey: null,
    };
  }

  // 'stream': pin as tightly as possible so it can auto-file safely.
  if (ctx.streamId != null) {
    return {
      scopeKind: "stream",
      streamId: ctx.streamId,
      merchantEntityId: null,
      merchantNorm: null,
      category: choice.category,
      propertyId: choice.propertyId ?? null,
      buildingKey: choice.buildingKey ?? null,
    };
  }

  // No stream_id: fall back to merchant identity narrowed by account + amount
  // band, so the same vendor on a different account/amount won't be captured.
  const tol = Math.max(0, Math.trunc(choice.amountToleranceCents ?? 0));
  return {
    scopeKind: "stream",
    streamId: null,
    merchantEntityId: ctx.merchantEntityId,
    merchantNorm: ctx.merchantEntityId != null ? null : merchantNorm,
    accountExternalId: ctx.accountExternalId,
    amountMinCents: ctx.amountCents - tol,
    amountMaxCents: ctx.amountCents + tol,
    category: choice.category,
    propertyId: choice.propertyId ?? null,
    buildingKey: choice.buildingKey ?? null,
  };
}
