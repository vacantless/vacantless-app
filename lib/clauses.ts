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

// --- Validation -------------------------------------------------------------

export type ClauseInput = {
  key: string;
  title: string;
  category?: string;
  applicableTo: string;
};
export type ClauseValidation =
  | {
      ok: true;
      value: {
        key: string;
        title: string;
        category: string;
        applicableTo: ClauseApplicability;
      };
    }
  | { ok: false; code: string };

// Stable key: lowercase letters, digits, underscore. Keeps keys safe as the
// assembler's select-by-key identifier and as a diff match key.
const CLAUSE_KEY_RE = /^[a-z0-9_]+$/;

/** Validate a new-clause submission. */
export function validateClauseInput(v: ClauseInput): ClauseValidation {
  const key = (v.key ?? "").trim().toLowerCase();
  const title = (v.title ?? "").trim();
  const category = (v.category ?? "general").trim() || "general";
  const applicableTo = (v.applicableTo ?? "").trim();

  if (!key) return { ok: false, code: "key_required" };
  if (!CLAUSE_KEY_RE.test(key)) return { ok: false, code: "key_invalid" };
  if (!title) return { ok: false, code: "title_required" };
  if (!isClauseApplicability(applicableTo)) return { ok: false, code: "applicable_to_invalid" };

  return { ok: true, value: { key, title, category, applicableTo } };
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
  category: string;
  applicableTo: ClauseApplicability;
  body: string;
};

export const RESIDENTIAL_CLAUSE_SEED: SeedClause[] = [
  {
    key: "pets",
    title: "Pets",
    category: "occupancy",
    applicableTo: "residential",
    body:
      "Pets: The Tenant may keep a pet in the rental unit. Under section 14 of the Residential Tenancies Act, 2006, any provision prohibiting pets is void; this clause governs conduct only. The Tenant agrees to keep any pet under control, to promptly remedy any damage caused by the pet at {{property_address}}, and to comply with the rules of the residential complex and any applicable condominium declaration.",
  },
  {
    key: "parking",
    title: "Parking",
    category: "amenities",
    applicableTo: "both",
    body:
      "Parking: The Tenant is assigned {{parking_spaces}} parking space(s) at the residential complex for one licensed, operable vehicle per space, at a monthly fee of {{parking_fee}} payable with the rent. Assigned spaces are for the Tenant’s use only and may not be assigned, sublet, or used for storage or repairs.",
  },
  {
    key: "smoking",
    title: "Smoking and Vaping",
    category: "conduct",
    applicableTo: "both",
    body:
      "Smoking and Vaping: Smoking or vaping of any substance, including tobacco and cannabis, is not permitted inside the rental unit or in any indoor common area of the residential complex. Smoke damage or persistent odour caused by a breach of this clause may be charged to the Tenant as damage beyond normal wear and tear.",
  },
  {
    key: "utilities",
    title: "Utilities",
    category: "financial",
    applicableTo: "residential",
    body:
      "Utilities: The following utilities are the responsibility of the Tenant and are not included in the rent: {{tenant_utilities}}. The following utilities are included and paid by the Landlord: {{included_utilities}}. The Tenant agrees to keep all tenant-paid utility accounts active for the full term of the tenancy.",
  },
  {
    key: "storage",
    title: "Storage",
    category: "amenities",
    applicableTo: "both",
    body:
      "Storage: The Tenant is provided {{storage_description}} for personal storage at the residential complex. The Landlord is not responsible for loss of or damage to stored items. No flammable, hazardous, or perishable materials may be stored, and storage areas must be kept clean and accessible.",
  },
];
