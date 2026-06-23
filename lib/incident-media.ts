// Pure, dependency-free helpers for incident-report media (Option B Slice 1).
//
// Everything here is deterministic and unit-tested (scripts/test-incident-media.ts)
// so the server actions, the migration's bucket/storage rules, and the UI all
// agree on the same limits, MIME whitelist, paths, and image/video split. No
// Supabase / Next imports. Mirrors lib/photos.ts; the difference is that media
// here includes short VIDEO and lives in a PRIVATE bucket (read via signed URL).

// ---------------------------------------------------------------------------
// Accepted file types — split into image vs video, since the size caps differ.
// These MUST match the bucket's allowed_mime_types in migration 0060.
// ---------------------------------------------------------------------------

// Web-renderable images only (same set as property photos minus gif — a leak
// photo has no reason to be animated). HEIC is rejected with a clear message
// rather than silently stored as something <img> can't show.
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

// Short video. video/quicktime covers the iPhone default .mov; mp4 + webm cover
// Android / desktop captures.
export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;
export type AllowedVideoType = (typeof ALLOWED_VIDEO_TYPES)[number];

export const ALLOWED_INCIDENT_MEDIA_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
] as const;
export type AllowedIncidentMediaType =
  (typeof ALLOWED_INCIDENT_MEDIA_TYPES)[number];

export type MediaKind = "image" | "video";

// ---------------------------------------------------------------------------
// Per-kind size caps. The bucket's file_size_limit (migration 0060) is set to
// the VIDEO cap (the larger of the two); we enforce the tighter image cap here
// and re-check both server-side. Video is hard-capped to keep storage cost and
// upload time sane (Slice-1 decision: ~30s / ~25 MB).
// ---------------------------------------------------------------------------
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB

// How many media items a single incident report can hold. Keeps payloads sane;
// the upload UI hides the control once this is reached.
export const MAX_MEDIA_PER_REPORT = 10;

export function isAllowedImageType(type: unknown): type is AllowedImageType {
  return (
    typeof type === "string" &&
    (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type)
  );
}

export function isAllowedVideoType(type: unknown): type is AllowedVideoType {
  return (
    typeof type === "string" &&
    (ALLOWED_VIDEO_TYPES as readonly string[]).includes(type)
  );
}

export function isAllowedMediaType(
  type: unknown,
): type is AllowedIncidentMediaType {
  return isAllowedImageType(type) || isAllowedVideoType(type);
}

/** The media kind for an accepted MIME type, or null if the type isn't allowed. */
export function kindForType(type: unknown): MediaKind | null {
  if (isAllowedImageType(type)) return "image";
  if (isAllowedVideoType(type)) return "video";
  return null;
}

/** The per-file byte ceiling for a given MIME type (image vs video). */
export function maxBytesForType(type: string): number {
  return isAllowedVideoType(type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export function isWithinSizeLimit(bytes: unknown, type: string): boolean {
  return (
    typeof bytes === "number" && bytes > 0 && bytes <= maxBytesForType(type)
  );
}

/** Human-readable size, e.g. "25 MB" — used in error copy. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb % 1 === 0 ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export type MediaUploadValidation =
  | { ok: true; kind: MediaKind }
  | { ok: false; reason: "type" | "size" | "empty" };

/**
 * Validate one selected file (anything with a .type + .size, e.g. a browser
 * File). Returns a discriminated result so callers can map a reason to copy and,
 * on success, the resolved media kind (image | video).
 */
export function validateMediaUpload(file: {
  type?: unknown;
  size?: unknown;
}): MediaUploadValidation {
  if (typeof file.size !== "number" || file.size <= 0) {
    return { ok: false, reason: "empty" };
  }
  const kind = kindForType(file.type);
  if (!kind) return { ok: false, reason: "type" };
  if (!isWithinSizeLimit(file.size, file.type as string)) {
    return { ok: false, reason: "size" };
  }
  return { ok: true, kind };
}

/** A short, plain-language message for a failed validation reason. */
export function mediaUploadErrorMessage(
  reason: "type" | "size" | "empty",
): string {
  switch (reason) {
    case "type":
      return "Unsupported file. Please upload a photo (JPG, PNG, WebP) or a short video (MP4, MOV, WebM).";
    case "size":
      return `That file is too large. Photos must be under ${formatBytes(
        MAX_IMAGE_BYTES,
      )} and videos under ${formatBytes(MAX_VIDEO_BYTES)}.`;
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
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    default:
      return "bin";
  }
}

/**
 * The object path inside the PRIVATE incident-media bucket. The FIRST segment is
 * the org id — the storage RLS policies (migration 0060) gate on exactly that
 * segment, so a write only lands under the owning org's folder. The report id
 * groups a report's media; the media id keeps names unique and unguessable
 * (important here — a guessed path is still useless without a signed URL, but
 * unguessable names are defense in depth for sensitive in-home media).
 */
export function incidentMediaStoragePath(
  orgId: string,
  incidentReportId: string,
  mediaId: string,
  ext: string,
): string {
  return `${orgId}/${incidentReportId}/${mediaId}.${ext}`;
}

/**
 * The file extension encoded in a stored object path (e.g. ".../abc.mp4" -> "mp4").
 * Falls back to "bin" for a path with no usable extension.
 */
export function extFromStoragePath(path: string): string {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "bin";
  return name.slice(dot + 1).toLowerCase();
}
