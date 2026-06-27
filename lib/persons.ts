// ============================================================================
// lib/persons — the per-person vault domain model (lease vault #11, slice 8).
//
// Pure, I/O-free, unit-testable. The migration 0042 added a durable org-scoped
// `persons` identity and linked tenants + lease_signers to it; this module holds
// the logic that both the BACKFILL (in SQL) and the LIVE path (server actions)
// must agree on — chiefly the IDENTITY RULE for "is this the same person?" —
// plus the read-side shaping the vault view needs (union the documents reached
// via a person's tenancies with the documents they personally signed).
//
// IDENTITY RULE (must match 0042's backfill DO block exactly): within one org, a
// person is matched by normalized email FIRST, then by E.164 phone. email_norm =
// lower(btrim(email)). Phones are normalized upstream by lib/sms.normalizePhoneE164
// (the same key tenants.phone_e164 / leads.phone_e164 use), so this module takes
// an already-normalized phone_e164 and never re-parses raw phone text.
// ============================================================================

// --- Normalization ----------------------------------------------------------

/** lower(btrim(email)) -> the match key, or null when blank. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/**
 * The single grouping key for a person: normalized email if present, else the
 * E.164 phone, else null (no reliable identity -> always a fresh person). Mirrors
 * the COALESCE(email_norm, phone_e164) intent of the backfill.
 */
export function personMatchKey(input: {
  email_norm: string | null;
  phone_e164: string | null;
}): string | null {
  return input.email_norm ?? input.phone_e164 ?? null;
}

// --- Matching ---------------------------------------------------------------

/** The minimum shape of a stored person needed to match against. */
export type PersonMatchRow = {
  id: string;
  email_norm: string | null;
  phone_e164: string | null;
};

/** A candidate to resolve, with its keys already normalized by the caller. */
export type PersonCandidate = {
  email_norm: string | null;
  phone_e164: string | null;
};

/**
 * Find the existing person a candidate resolves to, or null. Email match takes
 * precedence over phone match (a shared household phone is weaker evidence than
 * a personal email). Among email matches, the first wins; likewise for phone.
 * This is the read half of planResolvePerson and must mirror the SQL backfill.
 */
export function matchPerson(
  existing: PersonMatchRow[],
  cand: PersonCandidate,
): PersonMatchRow | null {
  if (cand.email_norm) {
    const byEmail = existing.find((p) => p.email_norm && p.email_norm === cand.email_norm);
    if (byEmail) return byEmail;
  }
  if (cand.phone_e164) {
    const byPhone = existing.find((p) => p.phone_e164 && p.phone_e164 === cand.phone_e164);
    if (byPhone) return byPhone;
  }
  return null;
}

/** What the caller should do to resolve a candidate to a person id. */
export type ResolvePersonPlan =
  | { kind: "existing"; id: string }
  | { kind: "create"; email_norm: string | null; phone_e164: string | null };

/**
 * Decide whether a candidate maps to an existing person (return its id) or needs
 * a new person created (return the normalized keys to store). The server action
 * fetches the small set of candidate persons (by org + the two keys), calls this,
 * and either links or inserts. Keeping the decision pure makes it testable and
 * keeps the live path byte-aligned with the backfill rule.
 */
export function planResolvePerson(
  existing: PersonMatchRow[],
  cand: PersonCandidate,
): ResolvePersonPlan {
  const hit = matchPerson(existing, cand);
  if (hit) return { kind: "existing", id: hit.id };
  return { kind: "create", email_norm: cand.email_norm, phone_e164: cand.phone_e164 };
}

// --- Display ----------------------------------------------------------------

/** A friendly label for a person: name, else email, else phone, else "Unnamed". */
export function personDisplayName(p: {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const name = (p.full_name ?? "").trim();
  if (name) return name;
  const email = (p.email ?? "").trim();
  if (email) return email;
  const phone = (p.phone ?? "").trim();
  if (phone) return phone;
  return "Unnamed person";
}

// --- Read-side shaping (the vault view) -------------------------------------

/** A document as the vault lists it. created_at/executed_at are ISO strings. */
export type VaultDocument = {
  id: string;
  tenancy_id: string | null;
  title: string;
  status: string;
  created_at: string;
  executed_at: string | null;
  /** true when this person is recorded as having SIGNED this document. */
  signed_by_person: boolean;
};

/** Dedupe rows by id, keeping the first occurrence. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * The person's full document set = the documents on their tenancies UNION the
 * documents they personally signed, deduped by id, newest first. The tenancy
 * path catches drafts not yet signed; the signer path catches anything they
 * signed (authoritative execution record) even if the tenant roster later
 * changed. `signedDocIds` marks which ids carry this person's signature.
 */
export function mergePersonDocuments(
  viaTenancy: Omit<VaultDocument, "signed_by_person">[],
  viaSigner: Omit<VaultDocument, "signed_by_person">[],
  signedDocIds: Iterable<string>,
): VaultDocument[] {
  const signed = new Set(signedDocIds);
  const merged = dedupeById([...viaTenancy, ...viaSigner]).map((d) => ({
    ...d,
    signed_by_person: signed.has(d.id),
  }));
  return merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * An UPLOADED vault file (the 0076 `documents` table) as the person view lists
 * it. Distinct from VaultDocument, which describes the in-app assembled lease
 * (`lease_documents`). created_at is an ISO string.
 */
export type VaultFile = {
  id: string;
  tenancy_id: string | null;
  person_id: string | null;
  title: string;
  doc_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

/**
 * A person's uploaded vault files = files reached via their tenancies UNION
 * files filed directly about them (`documents.person_id`), deduped by id,
 * newest first. The tenancy path catches anything stored on a lease the person
 * is on; the person path catches files filed about them even after the tenant
 * roster changes or the file was never tied to a tenancy.
 */
export function mergePersonVaultFiles(viaTenancy: VaultFile[], viaPerson: VaultFile[]): VaultFile[] {
  return dedupeById([...viaTenancy, ...viaPerson]).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

/** A tenancy as the vault lists it (one person across many of these). */
export type VaultTenancy = {
  id: string;
  property_address: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  is_primary: boolean;
};

/** Newest tenancy first (by start_date desc, nulls last). */
export function sortVaultTenancies(rows: VaultTenancy[]): VaultTenancy[] {
  return rows.slice().sort((a, b) => {
    if (a.start_date && b.start_date) return b.start_date.localeCompare(a.start_date);
    if (a.start_date) return -1;
    if (b.start_date) return 1;
    return 0;
  });
}

/** A person as the list page summarizes them. */
export type PersonSummary = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  tenancy_count: number;
  document_count: number;
};

/** Sort the people list by display name (case-insensitive). */
export function sortPeople(rows: PersonSummary[]): PersonSummary[] {
  return rows.slice().sort((a, b) =>
    a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase()),
  );
}
