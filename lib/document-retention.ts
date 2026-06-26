// Pure, dependency-free helpers for the document-vault RETENTION PURGE (the SAVE
// pillar of the landlord hub — DOCUMENT-VAULT-DESIGN-2026-06-26.md, Slice 3).
//
// The vault holds heavy protected PII (executed leases, ID/application packages,
// insurance certs). Soft-delete (documents-actions.deleteTenancyDocument) keeps
// the metadata ROW as an audit trail and removes the stored BYTES immediately,
// but the row — and any byte that a best-effort remove missed — would otherwise
// linger forever. This module decides WHEN a soft-deleted document is past its
// retention grace and should be permanently purged (row hard-deleted, bytes
// re-removed as a backstop) by app/api/cron/document-retention.
//
// Everything here is deterministic + unit-tested (scripts/test-document-retention)
// so the cron, the soft-delete stamp, and the migration's columns agree on one
// retention window. No Supabase / Next imports — pure date arithmetic.

// ---------------------------------------------------------------------------
// The grace window between soft-delete and permanent purge. A soft-deleted
// document stays recoverable-as-metadata (and its audit trail readable) for this
// long, then the cron hard-deletes it. 30 days mirrors a conventional
// short-retention / "recently deleted" window and gives an operator time to
// notice an accidental delete before the record is gone for good.
// ---------------------------------------------------------------------------
export const RETENTION_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Coerce an ISO string / Date / null into a finite epoch ms, or null. */
function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The ISO instant at which a document soft-deleted at `deletedAt` becomes due
 * for purge: deletedAt + graceDays. The soft-delete action stamps this onto
 * documents.retention_until so the cron has an explicit anchor; callers may
 * override the window (e.g. a future per-org retention policy).
 */
export function retentionUntil(
  deletedAt: string | Date,
  graceDays: number = RETENTION_GRACE_DAYS,
): string {
  const base = toMs(deletedAt) ?? Date.now();
  const days = Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : RETENTION_GRACE_DAYS;
  return new Date(base + days * DAY_MS).toISOString();
}

/** The minimum shape the purge decision reads off a document row. */
export type RetentionDoc = {
  deleted_at: string | null;
  retention_until: string | null;
};

/**
 * The effective purge anchor for a soft-deleted document, as epoch ms:
 *   - the explicit retention_until if set (the stamp the soft-delete writes), else
 *   - deleted_at + grace as a fallback (covers rows soft-deleted BEFORE this
 *     slice, which have a null retention_until), else
 *   - null when the document is not soft-deleted at all (never purge a live doc).
 */
export function effectiveRetentionUntilMs(
  doc: RetentionDoc,
  graceDays: number = RETENTION_GRACE_DAYS,
): number | null {
  const deleted = toMs(doc.deleted_at);
  if (deleted == null) return null; // live document — out of scope for the purge
  const explicit = toMs(doc.retention_until);
  if (explicit != null) return explicit;
  const days = Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : RETENTION_GRACE_DAYS;
  return deleted + days * DAY_MS;
}

/**
 * Whether a document is due for permanent purge at `now`: it must be soft-deleted
 * AND past its effective retention anchor. A live document (no deleted_at) is
 * never due, regardless of any stray retention_until.
 */
export function isDueForPurge(
  doc: RetentionDoc,
  now: Date,
  graceDays: number = RETENTION_GRACE_DAYS,
): boolean {
  const anchor = effectiveRetentionUntilMs(doc, graceDays);
  if (anchor == null) return false;
  return anchor <= now.getTime();
}

/** Filter a batch of documents down to those due for purge at `now`. */
export function dueForPurge<T extends RetentionDoc>(
  docs: T[],
  now: Date,
  graceDays: number = RETENTION_GRACE_DAYS,
): T[] {
  return docs.filter((d) => isDueForPurge(d, now, graceDays));
}
