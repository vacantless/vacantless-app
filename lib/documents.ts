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

/** The path to the public read-only viewer for a share token. */
export function documentSharePath(token: string): string {
  return `/d/${encodeURIComponent(token)}`;
}
