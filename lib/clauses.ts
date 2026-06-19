// Pure lease-clause domain model (no I/O) so it can be unit-tested in isolation.
//
// This is slice 1 of the lease-vault module (teardown entry #11). The competitive
// teardown (VACANTLESS-LEASE-VAULT-MODULE-BRIEF-2026-06-17.md) found that Ontario
// forms + e-sign + storage are all parity now; the ONE durable differentiator is
// CLAUSE-LEVEL versioning — knowing which exact clause wording was in force on
// which lease, diffing versions, and rolling forward at renewal. This module owns
// that logic, plus the assembler ported from Noam's docusign-automation project
// (make-offer-prefill.js: select-by-ID -> interpolate {{}} -> applicable_to scope
// -> join). The DB schema is migration 0039; server actions stay thin around this.
//
// Everything here is pure (string + array work, no DB). The same {{token}} idiom
// as lib/tenant-comms.ts is reused so the substitution behaves identically across
// the product.

// --- Applicability (scoping) ------------------------------------------------

// Which lease type a clause belongs in. 'both' = residential + commercial. The
// analogue of f121-clauses.json's `applicable_to` (freehold | condo | both).
export const CLAUSE_APPLICABILITIES = ["residential", "commercial", "both"] as const;
export type ClauseApplicability = (typeof CLAUSE_APPLICABILITIES)[number];

// The concrete lease type an assembly targets (never 'both' — you assemble for a
// specific lease).
export const LEASE_TYPES = ["residential", "commercial"] as const;
export type LeaseType = (typeof LEASE_TYPES)[number];

export function isClauseApplicability(v: string): v is ClauseApplicability {
  return (CLAUSE_APPLICABILITIES as readonly string[]).includes(v);
}

export function isLeaseType(v: string): v is LeaseType {
  return (LEASE_TYPES as readonly string[]).includes(v);
}

// --- Risk level (the Ontario guardrail badge) -------------------------------

// Every clause carries a visible risk level (Noam's clause review, 2026-06-18).
// It drives the UI badge and the caution / legal-review warning shown beside the
// clause. The point is to stop the tool quietly encouraging void terms: Ontario's
// Standard Lease says additional terms can't remove RTA rights, and the riskier a
// clause's subject (pets, deposits, penalties, guest limits) the louder we warn.
//   standard      — common, low-risk (parking, utilities, appliances, insurance).
//   caution       — valid but needs careful wording (pets, smoking, key deposits,
//                   flat charges, access rules).
//   legal_review  — review recommended (penalties, guest/roommate limits, damage
//                   deposits, tenant-paid repairs, anything unusual/custom).
export const RISK_LEVELS = ["standard", "caution", "legal_review"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(v: string): v is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(v);
}

// --- Jurisdiction -----------------------------------------------------------

// The legal context a clause's wording was authored for. Vacantless ships seed
// law for Ontario only today; 'canada' and 'custom' exist so an org can label
// its own clauses honestly rather than implying an Ontario basis they don't have.
export const JURISDICTIONS = ["ontario", "canada", "custom"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export function isJurisdiction(v: string): v is Jurisdiction {
  return (JURISDICTIONS as readonly string[]).includes(v);
}

// --- Categories (the practical, landlord-facing grouping) -------------------

// The six plain-language buckets Noam specified — categories landlords think in,
// not legal jargon. `category` stays free text in the DB (migration 0039's
// choice, so an org can add its own), but the seed uses these labels and the
// library UI groups + orders by this list, with anything unrecognized falling
// into a trailing "Other" group.
export const CLAUSE_CATEGORIES = [
  "Rent & Deposits",
  "Utilities & Services",
  "Use of Unit",
  "Move-In / Move-Out",
  "Maintenance / Access",
  "Property-Specific",
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

/**
 * Sort index for a category — its position in CLAUSE_CATEGORIES, or a large
 * number (so it sorts last, under "Other") for anything unrecognized. Lets the
 * UI render groups in the intended order without hard-coding it in the view.
 */
export function categoryOrder(category: string): number {
  const i = (CLAUSE_CATEGORIES as readonly string[]).indexOf(category);
  return i === -1 ? CLAUSE_CATEGORIES.length : i;
}

/**
 * Whether a clause scoped `applicableTo` belongs in a lease of type `target`.
 * A 'both' clause applies to every lease type; otherwise it must match exactly.
 */
export function clauseAppliesTo(
  applicableTo: ClauseApplicability,
  target: LeaseType,
): boolean {
  return applicableTo === "both" || applicableTo === target;
}

// --- Token substitution -----------------------------------------------------

/**
 * Substitute {{token}} placeholders (case-insensitive, optional inner spaces).
 * An unknown token is left as-is so a stray brace never silently vanishes — the
 * operator sees `{{parking_fee}}` and knows a value is still owed. Identical
 * idiom to lib/tenant-comms.ts applyMessageTokens.
 */
export function interpolateClause(
  body: string,
  vars: Record<string, string>,
): string {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, String(k).toLowerCase())
      ? vars[String(k).toLowerCase()]
      : m,
  );
}

/** The distinct {{token}} names referenced in a clause body, lowercased, in order. */
export function tokensInBody(body: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const tok = match[1].toLowerCase();
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

/** The token names still unresolved by `vars` for a body (what the operator owes). */
export function unresolvedTokens(
  body: string,
  vars: Record<string, string>,
): string[] {
  return tokensInBody(body).filter(
    (t) => !Object.prototype.hasOwnProperty.call(vars, t),
  );
}

// --- Versioning (the moat) --------------------------------------------------

// The shape the version helpers need — a subset of a lease_clause_versions row.
export type ClauseVersionLike = {
  id: string;
  version: number;
  is_current: boolean;
};

/** Next version number for a clause = max existing + 1 (1 when none exist). */
export function nextVersionNumber(versions: ClauseVersionLike[]): number {
  return versions.reduce((max, v) => (v.version > max ? v.version : max), 0) + 1;
}

/** The current version of a clause, or null if none is flagged current. */
export function currentVersion<T extends ClauseVersionLike>(
  versions: T[],
): T | null {
  return versions.find((v) => v.is_current) ?? null;
}

/** The highest-numbered version of a clause, or null if there are none. */
export function latestVersion<T extends ClauseVersionLike>(
  versions: T[],
): T | null {
  return versions.reduce<T | null>(
    (best, v) => (best === null || v.version > best.version ? v : best),
    null,
  );
}

export type SetCurrentPlan =
  | {
      ok: true;
      // version ids that must be cleared (is_current -> false) first.
      clear: string[];
      // the version id to set current after the clears (the clear-then-set rule).
      set: string;
      // true when the target was already current and nothing needs to change.
      noop: boolean;
    }
  | { ok: false; code: "not_found" };

/**
 * Plan the clear-then-set writes to make `targetId` the sole current version.
 * Enforces the one-designated-child rule: never flip current in a single UPDATE
 * (which can momentarily violate the partial-unique index); clear the others,
 * then set the target. Returns the exact id lists for the two writes.
 */
export function planSetCurrent(
  versions: ClauseVersionLike[],
  targetId: string,
): SetCurrentPlan {
  if (!versions.some((v) => v.id === targetId)) return { ok: false, code: "not_found" };
  const clear = versions
    .filter((v) => v.is_current && v.id !== targetId)
    .map((v) => v.id);
  const alreadyCurrent = versions.some((v) => v.id === targetId && v.is_current);
  return { ok: true, clear, set: targetId, noop: alreadyCurrent && clear.length === 0 };
}

/** True iff at most one version per clause is flagged current (the invariant). */
export function hasSingleCurrent(versions: ClauseVersionLike[]): boolean {
  return versions.filter((v) => v.is_current).length <= 1;
}

// --- Assembly (the ported make-offer-prefill assembler) ---------------------

// A clause paired with the version body to assemble. The caller resolves the
// current (or a pinned) version for each selected clause before assembly.
export type ResolvedClause = {
  clauseId: string;
  key: string;
  title: string;
  applicableTo: ClauseApplicability;
  versionId: string;
  version: number;
  body: string;
};

export type AssembleOptions = {
  // the lease type being assembled (drives applicable_to scoping).
  leaseType: LeaseType;
  // {{token}} -> value map applied to every clause body.
  vars?: Record<string, string>;
  // join separator between clause bodies (default blank line, like the assembler).
  separator?: string;
};

export type AssembledClause = ResolvedClause & {
  // the body after interpolation.
  rendered: string;
  // tokens in this clause still unresolved after interpolation.
  unresolved: string[];
};

export type AssemblyResult = {
  // the joined, interpolated text — what make-offer-prefill wrote into the doc.
  text: string;
  // per-clause detail, in assembly order, AFTER applicable_to filtering.
  clauses: AssembledClause[];
  // clauses dropped because they don't apply to this lease type (audit trail).
  excluded: { key: string; applicableTo: ClauseApplicability }[];
  // union of every token left unresolved across the included clauses.
  unresolved: string[];
};

/**
 * Assemble selected clauses into one block — the ported docusign-automation
 * flow: take clauses already selected (by id/key, in the desired order), drop
 * the ones that don't apply to this lease type, interpolate each body, and join.
 * Order is preserved from the input array (the caller owns ordering).
 */
export function assembleClauses(
  selected: ResolvedClause[],
  opts: AssembleOptions,
): AssemblyResult {
  const vars = opts.vars ?? {};
  const separator = opts.separator ?? "\n\n";

  const included: AssembledClause[] = [];
  const excluded: { key: string; applicableTo: ClauseApplicability }[] = [];

  for (const c of selected) {
    if (!clauseAppliesTo(c.applicableTo, opts.leaseType)) {
      excluded.push({ key: c.key, applicableTo: c.applicableTo });
      continue;
    }
    const rendered = interpolateClause(c.body, vars);
    included.push({ ...c, rendered, unresolved: unresolvedTokens(c.body, vars) });
  }

  const unresolved: string[] = [];
  for (const c of included) {
    for (const t of c.unresolved) if (!unresolved.includes(t)) unresolved.push(t);
  }

  return {
    text: included.map((c) => c.rendered).join(separator),
    clauses: included,
    excluded,
    unresolved,
  };
}

// --- Executed snapshot + renewal diff ---------------------------------------

// One entry of a lease_documents.executed_clause_versions snapshot: exactly
// which clause version was in force when the lease was assembled.
export type ExecutedClauseRef = {
  clause_id: string;
  key: string;
  title: string;
  version_id: string;
  version: number;
  body: string;
};

/** Build the executed-version snapshot from an assembly result (Pillar B). */
export function buildExecutedSnapshot(result: AssemblyResult): ExecutedClauseRef[] {
  return result.clauses.map((c) => ({
    clause_id: c.clauseId,
    key: c.key,
    title: c.title,
    version_id: c.versionId,
    version: c.version,
    body: c.body,
  }));
}

export type ClauseDiff = {
  // clauses present now but absent in the previously executed snapshot.
  added: ExecutedClauseRef[];
  // clauses present then but absent now.
  removed: ExecutedClauseRef[];
  // same clause key, different version (the wording the tenant signed changed).
  changed: { key: string; title: string; from: number; to: number }[];
  // same clause key, same version (unchanged since last signed).
  unchanged: ExecutedClauseRef[];
  // true iff nothing changed at all — a clean renewal.
  identical: boolean;
};

/**
 * Diff a previously executed snapshot against a freshly assembled one — the
 * roll-forward-at-renewal view: "here is what changed since the tenant last
 * signed." Matches clauses by key. This is the differentiator nobody else ships.
 */
export function diffSnapshots(
  previous: ExecutedClauseRef[],
  current: ExecutedClauseRef[],
): ClauseDiff {
  const prevByKey = new Map(previous.map((c) => [c.key, c]));
  const currByKey = new Map(current.map((c) => [c.key, c]));

  const added = current.filter((c) => !prevByKey.has(c.key));
  const removed = previous.filter((c) => !currByKey.has(c.key));
  const changed: ClauseDiff["changed"] = [];
  const unchanged: ExecutedClauseRef[] = [];

  for (const c of current) {
    const prev = prevByKey.get(c.key);
    if (!prev) continue; // counted in `added`
    if (prev.version !== c.version) {
      changed.push({ key: c.key, title: c.title, from: prev.version, to: c.version });
    } else {
      unchanged.push(c);
    }
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    identical: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

// --- Seed a new lease from the last signed one (start-from-last-signed) ------

export type SeedSelection = {
  // current-library clauseIds to pre-select in the wizard — the keys present in
  // the source snapshot that STILL exist in the library, each mapped to that
  // clause's CURRENT clauseId (in library order).
  clauseIds: string[];
  // the source-snapshot keys matched to a current library clause (library order).
  matchedKeys: string[];
  // source-snapshot keys with no current library clause (deleted/renamed since),
  // in snapshot order — surfaced so the operator knows the seed can't fully
  // reproduce the old lease rather than silently dropping clauses.
  missingKeys: string[];
};

/**
 * Map a previously executed lease snapshot to the clauses a NEW lease's wizard
 * should pre-select ("start from my last signed lease" — REAL-WORLD-INTAKE
 * item J). Matches by KEY (the same identity `diffSnapshots` uses) and resolves
 * each match to the library clause's CURRENT clauseId, so the new lease always
 * assembles the current wording — never a stale pinned version from the old
 * snapshot. Keys absent from the current library are reported in `missingKeys`,
 * not silently dropped. Order follows `library` for the selection (so the wizard
 * pre-checks in its own order) and the snapshot for `missingKeys`. Snapshot keys
 * are de-duplicated. Pure: the caller does the DB reads.
 */
export function seedSelectionFromSnapshot<
  T extends { clauseId: string; key: string },
>(library: T[], snapshot: { key: string }[]): SeedSelection {
  // De-dup the snapshot keys, preserving first-appearance order.
  const seen = new Set<string>();
  const snapKeys: string[] = [];
  for (const c of snapshot) {
    if (!seen.has(c.key)) {
      seen.add(c.key);
      snapKeys.push(c.key);
    }
  }
  const want = new Set(snapKeys);

  const clauseIds: string[] = [];
  const matchedKeys: string[] = [];
  const matched = new Set<string>();
  for (const c of library) {
    if (want.has(c.key)) {
      clauseIds.push(c.clauseId);
      matchedKeys.push(c.key);
      matched.add(c.key);
    }
  }
  const missingKeys = snapKeys.filter((k) => !matched.has(k));
  return { clauseIds, matchedKeys, missingKeys };
}

// --- Resolution + lease variables (the thin glue server actions need) -------

// The lease_clauses columns the resolver needs (snake_case, as the row comes
// back from supabase).
export type ClauseRowLike = {
  id: string;
  key: string;
  title: string;
  applicable_to: ClauseApplicability;
  // metadata added in slice 6 (migration 0041). Optional so the resolver and
  // existing callers that select only the core columns keep compiling.
  risk_level?: RiskLevel;
  jurisdiction?: Jurisdiction;
  notes_for_landlord?: string | null;
};

// The lease_clause_versions columns the resolver needs.
export type ClauseVersionRowLike = ClauseVersionLike & {
  clause_id: string;
  body: string;
};

/**
 * Resolve each clause to its CURRENT version, producing the ResolvedClause[] the
 * assembler consumes. Clauses with no current version are skipped. Order is
 * preserved from the `clauses` input — the caller owns ordering (e.g. sort by
 * category then key before calling). Pure: the server action does the DB read,
 * this does the join.
 */
export function resolveCurrentClauses(
  clauses: ClauseRowLike[],
  versions: ClauseVersionRowLike[],
): ResolvedClause[] {
  const currentByClause = new Map<string, ClauseVersionRowLike>();
  for (const v of versions) {
    if (v.is_current) currentByClause.set(v.clause_id, v);
  }
  const out: ResolvedClause[] = [];
  for (const c of clauses) {
    const v = currentByClause.get(c.id);
    if (!v) continue;
    out.push({
      clauseId: c.id,
      key: c.key,
      title: c.title,
      applicableTo: c.applicable_to,
      versionId: v.id,
      version: v.version,
      body: v.body,
    });
  }
  return out;
}

// The tenancy/unit fields a generated lease draws on. All optional so the
// caller passes whatever the records hold; empty/missing values are dropped so
// the assembler leaves the {{token}} visible (a value still owed) rather than
// substituting an empty string.
export type LeaseVarSource = {
  propertyAddress?: string | null;
  tenantName?: string | null;
  rent?: string | null;
  deposit?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  parkingSpaces?: string | null;
  parkingFee?: string | null;
  tenantUtilities?: string | null;
  includedUtilities?: string | null;
  storageDescription?: string | null;
};

/**
 * Build the {{token}} -> value map for assembleClauses from a tenancy/unit
 * source. Keys are the lowercase token names used in RESIDENTIAL_CLAUSE_SEED.
 * Empty/whitespace/missing values are OMITTED (not blanked) so an unfilled field
 * surfaces as an unresolved token the operator can see and complete. Pure.
 */
export function buildLeaseVars(src: LeaseVarSource): Record<string, string> {
  const pairs: [string, string | null | undefined][] = [
    ["property_address", src.propertyAddress],
    ["tenant_name", src.tenantName],
    ["rent", src.rent],
    ["deposit", src.deposit],
    ["start_date", src.startDate],
    ["end_date", src.endDate],
    ["parking_spaces", src.parkingSpaces],
    ["parking_fee", src.parkingFee],
    ["tenant_utilities", src.tenantUtilities],
    ["included_utilities", src.includedUtilities],
    ["storage_description", src.storageDescription],
  ];
  const out: Record<string, string> = {};
  for (const [k, v] of pairs) {
    const val = (v ?? "").trim();
    if (val) out[k] = val;
  }
  return out;
}

// --- Smart clause recommendations -------------------------------------------

// The unit / tenancy facts that drive a recommendation. All optional so the
// caller passes whatever the records hold; a missing fact just means "don't
// recommend on that basis". Booleans derived from the tenancy/unit record by the
// caller (e.g. parkingSpaces > 0 -> hasParking).
export type RecommendationFacts = {
  hasParking?: boolean; // a parking space is assigned
  parkingAtExtraCost?: boolean; // parking carries a monthly fee
  gasFlatFee?: boolean; // a flat gas amount is folded into rent
  tenantPaysHydro?: boolean; // hydro is a tenant-paid utility
  hasStorage?: boolean; // a locker / storage area is provided
  hasOutdoorSpace?: boolean; // balcony / terrace / yard
  petsRestricted?: boolean; // the pets field carries rules / notes
  hasEarlyAccess?: boolean; // an early-access date exists
  hasProratedRent?: boolean; // a partial first month applies
  appliancesIncluded?: boolean; // appliances come with the unit
  acWindowOnRequest?: boolean; // landlord supplies a seasonal window AC on request
  propertySpecific?: boolean; // special equipment / valves / building rules
};

export type ClauseRecommendation = { key: string; reason: string };

// Clauses worth surfacing on almost every residential tenancy regardless of the
// facts (the "Recommended for this tenancy" defaults Noam's UI sketch shows).
const BASELINE_RECOMMENDATIONS: ClauseRecommendation[] = [
  { key: "utilities", reason: "Set out who pays which utilities." },
  { key: "tenant_insurance", reason: "Standard on most tenancies; the Landlord's insurance won't cover the Tenant." },
  { key: "smoking", reason: "Record the smoking and vaping rules for the unit." },
];

/**
 * Recommend clause keys from unit/tenancy facts (Noam's smart-recommendation
 * spec). Returns a baseline set always worth showing, then fact-driven additions,
 * de-duplicated by key (first reason wins) and in a stable order. Pure: the
 * caller maps records -> facts and intersects the result with the org's actual
 * clause library before display (a recommended key the org has deleted is just
 * dropped). Recommends only keys that exist in RESIDENTIAL_CLAUSE_SEED.
 */
export function recommendClauses(facts: RecommendationFacts): ClauseRecommendation[] {
  const out: ClauseRecommendation[] = [...BASELINE_RECOMMENDATIONS];
  const add = (key: string, reason: string) => out.push({ key, reason });

  if (facts.hasParking) add("parking", "A parking space is assigned to this tenancy.");
  if (facts.parkingAtExtraCost)
    add("flat_monthly_charges", "Parking carries a monthly fee - confirm how it sits in the rent.");
  if (facts.gasFlatFee)
    add("flat_monthly_charges", "A flat gas amount is folded into the rent.");
  if (facts.tenantPaysHydro)
    add("utility_account_setup", "The Tenant pays hydro and must set up the account.");
  if (facts.hasStorage) add("storage", "A locker or storage area is provided.");
  if (facts.hasOutdoorSpace) add("outdoor_space", "The unit has a private balcony, terrace, or yard.");
  if (facts.petsRestricted)
    add("pets", "The pets field has rules - use the RTA-safe conduct clause (caution).");
  if (facts.hasEarlyAccess) {
    add("early_access", "An early-access date is set before the lease start.");
    add("tenant_insurance", "Confirm insurance covers the early-access period.");
  }
  if (facts.hasProratedRent) add("prorated_rent", "A partial first month applies.");
  if (facts.appliancesIncluded) add("appliances", "Appliances are included - list them to avoid disputes.");
  if (facts.acWindowOnRequest)
    add("seasonal_ac", "You supply a seasonal window or portable AC on request - set the install and removal terms.");
  if (facts.propertySpecific)
    add("custom_property", "This property has special terms (equipment, valves, building rules).");

  // De-dup by key, first reason wins, order preserved.
  const seen = new Set<string>();
  const deduped: ClauseRecommendation[] = [];
  for (const r of out) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    deduped.push(r);
  }
  return deduped;
}

// --- Clause-selection wizard glue (slice 7) ---------------------------------

// The {{token}}s the tenancy record itself supplies, so the conversion wizard
// fills them automatically and never asks the operator to type them. Everything
// else in a clause body is an operator-filled placeholder. Single source of
// truth shared by the wizard (which tokens to show inputs for) and the server
// action (which tokens it derives from the record vs. accepts from the form).
export const CANONICAL_LEASE_TOKENS = [
  "property_address",
  "tenant_name",
  "rent",
  "deposit",
  "start_date",
  "end_date",
] as const;

/** True iff `token` is one the tenancy record supplies automatically. */
export function isCanonicalLeaseToken(token: string): boolean {
  return (CANONICAL_LEASE_TOKENS as readonly string[]).includes(
    token.toLowerCase(),
  );
}

// A library clause annotated with whether it's recommended for a given tenancy
// and the reason — what the wizard renders (recommended ones pre-checked, with
// the reason shown beside them).
export type AnnotatedClause<T extends { key: string } = ResolvedClause> = T & {
  recommended: boolean;
  recommendReason: string | null;
};

/**
 * Annotate the org's resolved clause library with the recommendations for a
 * tenancy: mark which clauses `recommendClauses` flagged and carry the reason.
 * A recommended key the org doesn't have (deleted clause) simply doesn't appear
 * — recommendations are intersected with the real library here, not displayed
 * on their own. Order is preserved from `clauses` (the caller's category sort).
 * Pure.
 */
export function annotateRecommendations<T extends { key: string }>(
  clauses: T[],
  recommendations: ClauseRecommendation[],
): AnnotatedClause<T>[] {
  const reasonByKey = new Map(recommendations.map((r) => [r.key, r.reason]));
  return clauses.map((c) => ({
    ...c,
    recommended: reasonByKey.has(c.key),
    recommendReason: reasonByKey.get(c.key) ?? null,
  }));
}

/**
 * Pick the clauses the operator chose, by clause id, preserving the order of
 * the resolved library (NOT the order ids arrive in). Unknown ids are dropped —
 * so a forged/stale id in the submitted form can never assemble a clause that
 * isn't in the org's current library. Pure; the server action re-resolves the
 * library first, then calls this.
 */
export function selectClausesById<T extends { clauseId: string }>(
  resolved: T[],
  selectedIds: string[],
): T[] {
  const want = new Set(selectedIds);
  return resolved.filter((c) => want.has(c.clauseId));
}

/**
 * Collect operator-supplied placeholder values from submitted form entries:
 * every field named `${prefix}<token>` becomes `<token> -> value`. Token names
 * are lowercased; empty/whitespace values are dropped (so an untouched input
 * leaves the {{token}} visible rather than blanking it — same contract as
 * buildLeaseVars). Pure; takes plain [name, value] pairs so it's testable
 * without a FormData.
 */
export function collectVarFields(
  entries: Iterable<[string, string]>,
  prefix = "var_",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!k.startsWith(prefix)) continue;
    const token = k.slice(prefix.length).trim().toLowerCase();
    const val = (v ?? "").trim();
    if (token && val) out[token] = val;
  }
  return out;
}

// --- Validation -------------------------------------------------------------

export type ClauseInput = {
  key: string;
  title: string;
  category?: string;
  applicableTo: string;
  riskLevel?: string;
  jurisdiction?: string;
  notesForLandlord?: string | null;
};
export type ClauseValidation =
  | {
      ok: true;
      value: {
        key: string;
        title: string;
        category: string;
        applicableTo: ClauseApplicability;
        riskLevel: RiskLevel;
        jurisdiction: Jurisdiction;
        notesForLandlord: string | null;
      };
    }
  | { ok: false; code: string };

// Stable key: lowercase letters, digits, underscore. Keeps keys safe as the
// assembler's select-by-key identifier and as a diff match key.
const CLAUSE_KEY_RE = /^[a-z0-9_]+$/;

/**
 * Validate a new-clause submission. risk_level / jurisdiction default to the
 * safe values ('standard' / 'ontario') when blank so an older form post or a
 * minimal create still produces a valid row; an explicitly-supplied but unknown
 * value is rejected rather than silently coerced.
 */
export function validateClauseInput(v: ClauseInput): ClauseValidation {
  const key = (v.key ?? "").trim().toLowerCase();
  const title = (v.title ?? "").trim();
  const category = (v.category ?? "general").trim() || "general";
  const applicableTo = (v.applicableTo ?? "").trim();
  const riskRaw = (v.riskLevel ?? "").trim();
  const jurisRaw = (v.jurisdiction ?? "").trim();
  const notes = (v.notesForLandlord ?? "").trim();

  if (!key) return { ok: false, code: "key_required" };
  if (!CLAUSE_KEY_RE.test(key)) return { ok: false, code: "key_invalid" };
  if (!title) return { ok: false, code: "title_required" };
  if (!isClauseApplicability(applicableTo)) return { ok: false, code: "applicable_to_invalid" };

  const riskLevel: RiskLevel = riskRaw === "" ? "standard" : (riskRaw as RiskLevel);
  if (!isRiskLevel(riskLevel)) return { ok: false, code: "risk_level_invalid" };
  const jurisdiction: Jurisdiction = jurisRaw === "" ? "ontario" : (jurisRaw as Jurisdiction);
  if (!isJurisdiction(jurisdiction)) return { ok: false, code: "jurisdiction_invalid" };

  return {
    ok: true,
    value: {
      key,
      title,
      category,
      applicableTo,
      riskLevel,
      jurisdiction,
      notesForLandlord: notes || null,
    },
  };
}

export type VersionInput = { body: string; note?: string | null };
export type VersionValidation =
  | { ok: true; value: { body: string; note: string | null } }
  | { ok: false; code: string };

/** Validate a new clause-version submission (body required). */
export function validateVersionInput(v: VersionInput): VersionValidation {
  const body = (v.body ?? "").trim();
  if (!body) return { ok: false, code: "body_required" };
  const note = (v.note ?? "").trim();
  return { ok: true, value: { body, note: note || null } };
}

const CLAUSE_ERROR_MESSAGES: Record<string, string> = {
  key_required: "Give the clause a key (e.g. “pets”).",
  key_invalid: "The key can use only lowercase letters, numbers, and underscores.",
  title_required: "Give the clause a title.",
  applicable_to_invalid: "Choose where this clause applies (residential, commercial, or both).",
  risk_level_invalid: "Choose a risk level (standard, caution, or legal review).",
  jurisdiction_invalid: "Choose a jurisdiction (Ontario, Canada, or custom).",
  body_required: "The clause text can’t be empty.",
  not_found: "That clause version no longer exists.",
};

/** Human-readable message for a clause/version error code, or null if unknown. */
export function clauseErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return CLAUSE_ERROR_MESSAGES[code] ?? null;
}

// --- Residential seed (clause version 1) ------------------------------------

// SINGLE SOURCE OF TRUTH for the starter residential clause library. Inserted as
// version 1 of each clause at org onboarding. Noam later edits any of these to a
// version 2 (his real DocuSign/SkySlope additional-terms language), which is what
// exercises the per-clause versioning path end to end.
//
// Bodies carry {{token}} placeholders the assembler fills from the tenancy/unit
// record (e.g. {{parking_spaces}}, {{parking_fee}}, {{tenant_utilities}}). Where
// an Ontario RTA rule materially constrains the wording, the default body states
// it accurately rather than offering a clause that would be void (e.g. a no-pets
// prohibition is void under RTA s.14) — Noam can still override in version 2.
export type SeedClause = {
  key: string;
  title: string;
  category: ClauseCategory;
  applicableTo: ClauseApplicability;
  riskLevel: RiskLevel;
  jurisdiction: Jurisdiction;
  notesForLandlord: string;
  body: string;
};

// The 15 starter clauses Noam specified in the clause-section review (seed.rtf /
// seed1.rtf, 2026-06-18). Enough to be useful immediately without turning
// Vacantless into a legal-drafting platform. Bodies carry {{token}} placeholders
// the assembler fills per tenancy; tokens the tenancy record can't supply (e.g.
// {{key_deposit}}, {{insurance_deadline}}) stay visible at generation so the
// operator fills them deliberately. Where an Ontario RTA rule constrains the
// wording, the default body states it accurately rather than offering a clause
// that would be void (e.g. a blanket no-pets prohibition is void under RTA s.14).
// Hyphens, not em dashes, in clause text (Noam's drafted-content rule).
export const RESIDENTIAL_CLAUSE_SEED: SeedClause[] = [
  {
    key: "parking",
    title: "Parking",
    category: "Utilities & Services",
    applicableTo: "both",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use when parking is included or available. Set the spaces and any monthly fee per tenancy.",
    body:
      "Parking: The Tenant is assigned {{parking_spaces}} parking space(s) at the residential complex for one licensed, operable vehicle per space, at a monthly fee of {{parking_fee}} payable with the rent. Assigned spaces are for the Tenant's use only and may not be assigned, sublet, or used for storage or repairs.",
  },
  {
    key: "storage",
    title: "Storage",
    category: "Utilities & Services",
    applicableTo: "both",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use when a locker or storage area is provided. Describe the space and note the Landlord isn't responsible for stored items.",
    body:
      "Storage: The Tenant is provided {{storage_description}} for personal storage at the residential complex. The Landlord is not responsible for loss of or damage to stored items. No flammable, hazardous, or perishable materials may be stored, and storage areas must be kept clean and accessible.",
  },
  {
    key: "utilities",
    title: "Utilities",
    category: "Utilities & Services",
    applicableTo: "residential",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Set out which utilities the Tenant pays and which are included. One of the most important clauses to get right.",
    body:
      "Utilities: The following utilities are the responsibility of the Tenant and are not included in the rent: {{tenant_utilities}}. The following utilities are included and paid by the Landlord: {{included_utilities}}. The Tenant agrees to keep all tenant-paid utility accounts active for the full term of the tenancy.",
  },
  {
    key: "utility_account_setup",
    title: "Utility Account Setup",
    category: "Move-In / Move-Out",
    applicableTo: "residential",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use when the Tenant must open hydro, gas, or internet accounts before moving in.",
    body:
      "Utility Account Setup: The Tenant agrees to arrange and pay for any required utility account ({{utility_provider}}) effective as of the commencement of the tenancy or any earlier possession date, and to provide proof of setup upon request.",
  },
  {
    key: "flat_monthly_charges",
    title: "Flat Monthly Charges",
    category: "Rent & Deposits",
    applicableTo: "residential",
    riskLevel: "caution",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use for a flat monthly amount (e.g. gas, snow/gardening) included in lawful rent. Word it carefully so it does not conflict with the lawful rent structure.",
    body:
      "Flat Monthly Charges: A monthly amount of {{charge_amount}} for {{charge_name}} is included as part of the lawful rent payable under this tenancy. This amount is not a separate fee and is included in the rent figure set out in the lease.",
  },
  {
    key: "tenant_insurance",
    title: "Tenant Insurance",
    category: "Move-In / Move-Out",
    applicableTo: "both",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Standard and widely used. The Landlord's insurance does not cover the Tenant's belongings or liability.",
    body:
      "Tenant Insurance: The Tenant agrees to obtain and maintain tenant insurance, including liability coverage and coverage for the Tenant's personal belongings, throughout the tenancy, and to provide proof of coverage upon request. The Landlord's insurance does not cover the Tenant's property or liability.",
  },
  {
    key: "smoking",
    title: "Smoking and Vaping",
    category: "Use of Unit",
    applicableTo: "both",
    riskLevel: "caution",
    jurisdiction: "ontario",
    notesForLandlord:
      "Valid in Ontario but must be worded with care and still respect the Human Rights Code.",
    body:
      "Smoking and Vaping: Smoking or vaping of any substance, including tobacco and cannabis, is not permitted inside the rental unit or in any indoor common area of the residential complex, and cannabis cultivation is not permitted in or around the premises. Smoke damage or persistent odour caused by a breach of this clause may be charged to the Tenant as damage beyond normal wear and tear.",
  },
  {
    key: "pets",
    title: "Pets / Condo or Building Rules",
    category: "Use of Unit",
    applicableTo: "residential",
    riskLevel: "caution",
    jurisdiction: "ontario",
    notesForLandlord:
      "Do not use a blanket no-pets clause in Ontario - it is void under RTA s.14. This clause governs conduct and condo rules only.",
    body:
      "Pets / Condo or Building Rules: The Tenant may keep a pet in the rental unit. Under section 14 of the Residential Tenancies Act, 2006, any provision prohibiting pets is void; this clause governs conduct only. The Tenant is responsible for ensuring that any pet does not cause damage, unreasonable noise, safety concerns, or interference with other residents, must promptly remedy any pet-related damage at {{property_address}}, and must comply with any applicable condominium or building rules.",
  },
  {
    key: "appliances",
    title: "Appliances",
    category: "Maintenance / Access",
    applicableTo: "both",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Useful to avoid move-in disputes. List the specific appliances included.",
    body:
      "Appliances: The following appliances are included with the rental unit and will be in good working order at commencement: {{appliances_included}}. The Tenant is responsible for the ordinary cleanliness and proper use of these appliances.",
  },
  {
    key: "seasonal_ac",
    title: "Seasonal Air Conditioner",
    category: "Maintenance / Access",
    applicableTo: "residential",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use when you supply a seasonal window or portable air-conditioning unit on request (not a permanent wall-mounted unit). The Tenant installs, removes, and stores it each season and is responsible for safe installation.",
    body:
      "Seasonal Air Conditioner: The rental unit is not supplied with air conditioning. On the Tenant's request, the Landlord will provide one window or portable air-conditioning unit for the Tenant's seasonal use. The Tenant is responsible for installing the unit safely at the start of each cooling season and for removing and storing it at the end of each season; the Landlord is not responsible for installing, removing, or storing the unit. The Tenant is responsible for safe installation and for any damage resulting from the installation, use, removal, or storage of the unit, beyond normal wear and tear.",
  },
  {
    key: "alterations",
    title: "Alterations / Decorating",
    category: "Maintenance / Access",
    applicableTo: "both",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Common and useful. Sets expectations on painting, fixtures, and wall anchors before move-out.",
    body:
      "Alterations / Decorating: The Tenant shall not paint, wallpaper, alter, or install fixtures in the rental unit without the Landlord's prior written consent. Artwork and window coverings are permitted using reasonable fasteners; any permitted wall anchors or screws must be properly patched and sanded before the end of the tenancy, and no adhesives may be applied to walls or ceilings.",
  },
  {
    key: "keys_locks",
    title: "Keys, Fobs and Locks",
    category: "Move-In / Move-Out",
    applicableTo: "both",
    riskLevel: "caution",
    jurisdiction: "ontario",
    notesForLandlord:
      "Be careful with deposits: in Ontario a key deposit must not exceed the expected replacement cost.",
    body:
      "Keys, Fobs and Locks: The Tenant is provided {{keys_provided}}. Any refundable key or access-device deposit ({{key_deposit}}) must not exceed the expected replacement cost and is returned when the devices are returned. The Tenant shall not change or install locks or access devices without the Landlord's prior written consent.",
  },
  {
    key: "early_access",
    title: "Early Access",
    category: "Move-In / Move-Out",
    applicableTo: "both",
    riskLevel: "caution",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use when the Tenant moves in before the official lease start. Make clear it does not change the start date.",
    body:
      "Early Access: The Landlord may provide early access to the rental unit on {{early_access_date}} for move-in purposes only. Early access does not change the official tenancy start date of {{start_date}} unless expressly agreed in writing. Tenant insurance and any tenant-paid utilities must be in effect for the early-access period.",
  },
  {
    key: "prorated_rent",
    title: "Prorated Rent",
    category: "Rent & Deposits",
    applicableTo: "both",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use for a partial first month. Stands alone or pairs with the Early Access clause.",
    body:
      "Prorated Rent: The Tenant shall pay prorated rent of {{prorated_rent}} for the period from {{prorated_period_start}} to {{prorated_period_end}}. Full monthly rent begins on {{full_rent_start_date}}.",
  },
  {
    key: "outdoor_space",
    title: "Balcony / Terrace / Outdoor Space",
    category: "Use of Unit",
    applicableTo: "residential",
    riskLevel: "standard",
    jurisdiction: "ontario",
    notesForLandlord:
      "Use when the unit has a private balcony, terrace, or yard. Covers cleanliness, safe use, and access for equipment.",
    body:
      "Balcony / Terrace / Outdoor Space: The Tenant is responsible for the ordinary cleanliness and proper use of {{outdoor_space_description}}, subject to applicable building rules and the Landlord's reasonable right of access for repairs or equipment. No unsafe storage and no alterations are permitted in the outdoor area.",
  },
  {
    key: "shared_responsibility",
    title: "Shared Responsibilities (Voluntary)",
    category: "Property-Specific",
    applicableTo: "residential",
    riskLevel: "legal_review",
    jurisdiction: "ontario",
    notesForLandlord:
      "Voluntary-cooperation wording only. Under RTA s.20 the Landlord is responsible for maintaining the residential complex; a lease clause that shifts common-area maintenance (snow, lawn, shared garbage) to a tenant is void (Montgomery v. Van, 2009 ONCA 808), even if signed. To make a task genuinely enforceable, use a SEPARATE compensation agreement, not this clause. Have it reviewed before relying on it.",
    body:
      "Shared Responsibilities (Voluntary): For the mutual convenience of all residents, the Tenant agrees to cooperate in a voluntary rotation for {{shared_task_name}} ({{shared_task_scope}}) on the following schedule: {{shared_task_schedule}}, rotating as {{shared_task_rotation}}. This arrangement is a community conduct guideline only. It does not shift the Landlord's statutory maintenance obligations under the Residential Tenancies Act, 2006, and the Landlord remains responsible for maintaining the residential complex.",
  },
  {
    key: "custom_property",
    title: "Custom Property-Specific Clause",
    category: "Property-Specific",
    applicableTo: "both",
    riskLevel: "legal_review",
    jurisdiction: "custom",
    notesForLandlord:
      "For unique property terms (valve access, shared equipment, building rules). Custom clauses may affect legal rights - consider legal review before use.",
    body: "{{custom_clause_text}}",
  },
];
