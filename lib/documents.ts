// Pure, dependency-free helpers for the document vault (the SAVE pillar of the
// landlord hub — DOCUMENT-VAULT-DESIGN-2026-06-26.md, Slices 1+2).
//
// Everything here is deterministic and unit-tested (scripts/test-documents.ts)
// so the server actions, the migration's bucket/storage rules, and the UI all
// agree on the same limits, MIME whitelist, paths, doc types, and share-link
// validity. No Supabase / Next imports. Mirrors lib/incident-media.ts; the
// difference is the document vault stores PDFs (+ scan images) and adds the
// tokenized share-link lifecycle.
//
// `crypto` is used ONLY for the share token (the same 192-bit base64url
// magic-link pattern as lib/lease-signing.generateSignToken) — kept here so the
// share-link logic is one testable place. Everything else is pure string/number
// work.

import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Accepted file types. MUST match the bucket's allowed_mime_types in migration
// 0076. PDF is the primary type (executed leases/notices); the three image
// types cover scanned pages. .docx is deliberately excluded — the vault stores
// EXECUTED artifacts, not editable drafts.
// ---------------------------------------------------------------------------
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Size cap. 25 MB fits under the 30 MB server-action body limit (next.config),
// so an operator upload rides a server action without raising it. MUST match
// the bucket file_size_limit in migration 0076. Executed leases + multi-page
// scans sit comfortably under this.
// ---------------------------------------------------------------------------
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

// How many files a single upload submit may carry (keeps the multipart body and
// the per-request work bounded; the UI caps the picker to match).
export const MAX_DOCUMENTS_PER_UPLOAD = 10;

// ---------------------------------------------------------------------------
// Document type taxonomy. MUST match the doc_type CHECK in migration 0076.
// ---------------------------------------------------------------------------
export const DOCUMENT_TYPES = [
  "lease",
  "amendment",
  "notice",
  "insurance",
  "id_package",
  "statement",
  "receipt",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === "string" && (DOCUMENT_TYPES as readonly string[]).includes(v);
}

/** A short, friendly label for a doc type (the upload picker + the list). */
export function documentTypeLabel(t: string): string {
  switch (t) {
    case "lease":
      return "Lease";
    case "amendment":
      return "Amendment";
    case "notice":
      return "Notice";
    case "insurance":
      return "Insurance";
    case "id_package":
      return "ID / application package";
    case "statement":
      return "Statement";
    case "receipt":
      return "Receipt";
    case "other":
    default:
      return "Other";
  }
}

// ---------------------------------------------------------------------------
// Type / size validation
// ---------------------------------------------------------------------------
export function isAllowedDocumentType(type: unknown): type is AllowedDocumentType {
  return (
    typeof type === "string" &&
    (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(type)
  );
}

export function isWithinDocumentSize(bytes: unknown): boolean {
  return typeof bytes === "number" && bytes > 0 && bytes <= MAX_DOCUMENT_BYTES;
}

/** Human-readable size, e.g. "2.4 MB" — used in error copy + the list. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb % 1 === 0 ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export type DocumentUploadValidation =
  | { ok: true }
  | { ok: false; reason: "type" | "size" | "empty" };

/**
 * Validate one selected file (anything with a .type + .size, e.g. a browser
 * File). Discriminated result so callers can map a reason to copy.
 */
export function validateDocumentUpload(file: {
  type?: unknown;
  size?: unknown;
}): DocumentUploadValidation {
  if (typeof file.size !== "number" || file.size <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (!isAllowedDocumentType(file.type)) return { ok: false, reason: "type" };
  if (!isWithinDocumentSize(file.size)) return { ok: false, reason: "size" };
  return { ok: true };
}

/** A short, plain-language message for a failed validation reason. */
export function documentUploadErrorMessage(
  reason: "type" | "size" | "empty",
): string {
  switch (reason) {
    case "type":
      return "Unsupported file. Upload a PDF, or a scan image (JPG, PNG, WebP).";
    case "size":
      return `That file is too large. Documents must be under ${formatBytes(
        MAX_DOCUMENT_BYTES,
      )}.`;
    case "empty":
      return "That file appears to be empty.";
  }
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

/** File extension (no dot) for a stored object, derived from its mime type. */
export function extForType(type: string): string {
  switch (type) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

/**
 * The object path inside the PRIVATE documents bucket. The FIRST segment is the
 * org id — the storage RLS policies (migration 0076) gate on exactly that
 * segment, so a write only lands under the owning org's folder. The doc id (a
 * random uuid) keeps names unique and unguessable; even a leaked path is useless
 * without a signed URL, and it is org-gated regardless.
 */
export function documentStoragePath(orgId: string, docId: string, ext: string): string {
  return `${orgId}/${docId}.${ext}`;
}

/**
 * A clean default title from an uploaded file name: strips the extension and any
 * leading path, trims, and falls back to "Document" for an empty/odd name.
 */
export function defaultTitleFromFilename(name: unknown): string {
  if (typeof name !== "string") return "Document";
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  return stem.length > 0 ? stem : "Document";
}

// ---------------------------------------------------------------------------
// Share links — token + expiry lifecycle
// ---------------------------------------------------------------------------

/** Default + max validity for a share link. No "forever" option by design. */
export const SHARE_LINK_DEFAULT_DAYS = 7;
export const SHARE_LINK_MAX_DAYS = 30;

/**
 * An unguessable share token: base64url of 24 random bytes = 32 url-safe chars,
 * ~192 bits. Identical scheme to lib/lease-signing.generateSignToken — far
 * beyond brute force and safe in a URL path (no +/= to encode). This is the only
 * handle a share recipient ever holds.
 */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Clamp a requested validity (days) into [1, SHARE_LINK_MAX_DAYS]. */
export function clampShareDays(days: unknown): number {
  const n = typeof days === "number" ? days : parseInt(String(days ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return SHARE_LINK_DEFAULT_DAYS;
  return Math.min(Math.floor(n), SHARE_LINK_MAX_DAYS);
}

/** The ISO expiry for a share link created at `now`, valid for `days`. */
export function shareLinkExpiry(now: Date, days: number): string {
  const ms = clampShareDays(days) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms).toISOString();
}

export type ShareLinkLike = {
  expires_at: string | null;
  revoked_at: string | null;
};

/** A share link is usable iff it is not revoked and not past its expiry. */
export function isShareLinkValid(link: ShareLinkLike, now: Date): boolean {
  if (link.revoked_at) return false;
  if (!link.expires_at) return false;
  const exp = Date.parse(link.expires_at);
  if (!Number.isFinite(exp)) return false;
  return exp > now.getTime();
}

/** A short status word for a share link, for the operator's list. */
export function shareLinkStatus(
  link: ShareLinkLike,
  now: Date,
): "active" | "expired" | "revoked" {
  if (link.revoked_at) return "revoked";
  if (isShareLinkValid(link, now)) return "active";
  return "expired";
}

// ---------------------------------------------------------------------------
// Slice 4 — in-app executed leases as vault entries (read-model unification).
//
// An in-app lease signed via the #11 signing rail is NOT a stored file: its
// bytes are reconstructed on demand by the lease render route (frozen
// rendered_snapshot + stamped signatures, Print → Save as PDF), and the vault
// bucket only accepts PDFs/images. Rather than mint a phantom `documents` row
// with no bytes (which would then need special-casing in the retention purge,
// share-out, and a backfill), we surface executed leases in the document vault
// as LINKED, read-only entries beside the uploaded files — one unified history,
// no migration, no write, idempotent by construction. The pre-provisioned
// `documents.source`/`lease_document_id` columns stay available for a future
// "real stored PDF" slice if a PDF render path is ever added.
// ---------------------------------------------------------------------------

/** A read-only document-vault entry for an in-app lease executed via the
 * signing rail. Not a stored file — the View/Certificate links resolve to the
 * on-demand render + audit routes. */
export type InAppLeaseEntry = {
  id: string;
  title: string;
  created_at: string;
  /** when the last signer signed (lease flipped to 'executed'); may be null on pre-slice rows. */
  executed_at: string | null;
};

/** Minimal lease shape this consumes (a subset of the tenancy's lease rows). */
export type LeaseStatusLike = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  executed_at?: string | null;
};

/** Filter a tenancy's leases to the EXECUTED ones and shape them as read-only
 * vault entries, newest first (by executed_at, falling back to created_at).
 * Pure — no DB/IO; unit-tested. */
export function executedLeaseVaultEntries(
  leases: LeaseStatusLike[],
): InAppLeaseEntry[] {
  return leases
    .filter((l) => l.status === "executed")
    .map((l) => ({
      id: l.id,
      title: l.title,
      created_at: l.created_at,
      executed_at: l.executed_at ?? null,
    }))
    .sort((a, b) => {
      const ax = a.executed_at ?? a.created_at;
      const bx = b.executed_at ?? b.created_at;
      // newest first; localeCompare on ISO strings is chronological.
      return bx.localeCompare(ax);
    });
}

/** The path to the public read-only viewer for a share token. */
export function documentSharePath(token: string): string {
  return `/d/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Slice 4b (Option C) — a stored, shareable PDF of an executed in-app lease.
//
// The operator Prints the executed lease (the on-demand render route) to PDF and
// files it here; the filing writes a `documents` row with source='in_app_executed'
// + lease_document_id pointing at the lease (the pre-provisioned 0076 columns).
// That row then participates in the vault exactly like an uploaded file — signed
// download URLs, the tokenized /d/[token] share-out, soft-delete + retention —
// EXCEPT it is folded into its lease's "Signed in app" entry rather than shown as
// a separate uploaded file, so each executed lease appears exactly once.
//
// `partitionVaultDocuments` is the pure split: given the tenancy's vault docs and
// the set of its executed-lease ids, it returns the uploaded docs (everything the
// "Uploaded files" list shows) and the newest stored PDF per lease (folded into
// the "Signed in app" entries). A source='in_app_executed' row whose lease is NOT
// in the set (e.g. lease_document_id was SET NULL when the lease row was removed,
// or the lease is no longer executed) falls back into the uploaded list so it can
// never silently disappear from the UI.
// ---------------------------------------------------------------------------

/** True for a vault row that is a stored PDF of an in-app executed lease. */
export function isExecutedLeasePdf(source: unknown): boolean {
  return source === "in_app_executed";
}

/** Minimal vault-row shape the partition consumes; the caller's richer row type
 * flows through unchanged via the generic. */
export type VaultDocRowLike = {
  id: string;
  source?: string | null;
  lease_document_id?: string | null;
};

/**
 * Split a tenancy's vault documents (assumed newest-first) into the uploaded list
 * and a per-lease map of the stored executed-lease PDF. Only a source=
 * 'in_app_executed' row whose lease_document_id is in `executedLeaseIds` is
 * folded out of the uploaded list; the FIRST such row per lease wins (newest,
 * given newest-first input). Pure — no IO; unit-tested.
 */
export function partitionVaultDocuments<T extends VaultDocRowLike>(
  docs: T[],
  executedLeaseIds: Iterable<string>,
): { uploaded: T[]; executedPdfByLeaseId: Map<string, T> } {
  const leaseSet = new Set(executedLeaseIds);
  const executedPdfByLeaseId = new Map<string, T>();
  const uploaded: T[] = [];
  for (const d of docs) {
    const lid = d.lease_document_id ?? null;
    if (isExecutedLeasePdf(d.source) && lid && leaseSet.has(lid)) {
      if (executedPdfByLeaseId.has(lid)) continue; // keep newest; drop extra
      executedPdfByLeaseId.set(lid, d);
    } else {
      uploaded.push(d);
    }
  }
  return { uploaded, executedPdfByLeaseId };
}
