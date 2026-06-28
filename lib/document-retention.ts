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

// ---------------------------------------------------------------------------
// Pending scan-capture lifecycle (S365 Phase 2 — CAPTURE-PHASE2-PENDING-DOC-
// LIFECYCLE-2026-06-28.md). A photo-OCR scan stores the image as a `documents`
// row BEFORE the appliance it belongs to exists (the Add form is only prefilled,
// not yet saved). Such a row carries pending_until = scan time + grace and a NULL
// appliance_id. On confirm (addAppliance) it is promoted (appliance_id set,
// pending_until -> NULL) and becomes a normal receipt. If the landlord abandons
// the form, this decides when the unconfirmed capture is reaped — bytes removed +
// the row HARD-deleted (never confirmed => no audit value, unlike the 30-day
// soft-delete purge above). Disjoint from that purge: this acts only on rows that
// are pending AND not soft-deleted; the purge acts only on soft-deleted rows.
//
// Pure date arithmetic, unit-tested alongside the purge.
// ---------------------------------------------------------------------------

/** Grace between storing an unconfirmed scan capture and reaping it. Short: a
 * landlord reviewing a prefilled form confirms within minutes; 6h forgives a
 * distracted user without letting abandoned bytes accumulate (the GitHub-Actions
 * sweep runs ~every 4h, so an abandoned byte lives ~10h worst case). */
export const PENDING_CAPTURE_GRACE_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

/** The ISO instant at which a capture stored at `storedAt` should be reaped if
 * still unconfirmed: storedAt + graceHours. The scan action stamps this onto
 * documents.pending_until. */
export function pendingCaptureUntil(
  storedAt: string | Date,
  graceHours: number = PENDING_CAPTURE_GRACE_HOURS,
): string {
  const base = toMs(storedAt) ?? Date.now();
  const hours =
    Number.isFinite(graceHours) && graceHours >= 0 ? graceHours : PENDING_CAPTURE_GRACE_HOURS;
  return new Date(base + hours * HOUR_MS).toISOString();
}

/** The minimum shape the reap decision reads off a document row. */
export type PendingCaptureDoc = {
  pending_until: string | null;
  appliance_id: string | null;
  deleted_at: string | null;
};

/**
 * Whether an unconfirmed scan capture is reapable at `now`: it must still be
 * pending (pending_until set), still unlinked (appliance_id null), NOT soft-
 * deleted (that path is the purge's, not the reaper's), AND past its
 * pending_until. A promoted receipt (pending_until null) or a linked row is never
 * reapable.
 */
export function isReapablePendingCapture(doc: PendingCaptureDoc, now: Date): boolean {
  if (doc.deleted_at != null) return false; // soft-deleted => the purge's job, not ours
  if (doc.appliance_id != null) return false; // already confirmed/linked
  const until = toMs(doc.pending_until);
  if (until == null) return false; // not a pending capture
  return until <= now.getTime();
}

/** Filter a batch down to the unconfirmed scan captures reapable at `now`. */
export function dueForReapPendingCaptures<T extends PendingCaptureDoc>(
  docs: T[],
  now: Date,
): T[] {
  return docs.filter((d) => isReapablePendingCapture(d, now));
}
