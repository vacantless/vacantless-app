// Pure, dependency-free helpers for the property-photo MVP.
//
// Everything here is deterministic and unit-tested (scripts/test-photos.ts) so
// the server actions, the migration's storage rules, and the UI all agree on
// the same limits, paths, and ordering rules. No Supabase / Next imports.

// ---------------------------------------------------------------------------
// Limits + accepted file types
// ---------------------------------------------------------------------------

// Web-renderable image types only. iPhone HEIC and other formats are rejected
// with a clear message rather than silently stored as something <img> can't
// show. These MUST match the bucket's allowed_mime_types in migration 0019.
export const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export type AllowedPhotoType = (typeof ALLOWED_PHOTO_TYPES)[number];

// Per-file ceiling. Matches the bucket's file_size_limit in migration 0019.
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

// How many photos a single unit can hold. Keeps the gallery + upload payloads
// sane; the UI hides the upload control once this is reached.
export const MAX_PHOTOS_PER_PROPERTY = 24;

export function isAllowedPhotoType(type: unknown): type is AllowedPhotoType {
  return (
    typeof type === "string" &&
    (ALLOWED_PHOTO_TYPES as readonly string[]).includes(type)
  );
}

export function isWithinSizeLimit(bytes: unknown): boolean {
  return typeof bytes === "number" && bytes > 0 && bytes <= MAX_PHOTO_BYTES;
}

/** Human-readable size, e.g. 10 MB — used in error copy. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb % 1 === 0 ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export type UploadValidation =
  | { ok: true }
  | { ok: false; reason: "type" | "size" | "empty" };

/**
 * Validate one selected file (anything with a .type + .size, e.g. a browser
 * File). Returns a discriminated result so callers can map a reason to copy.
 */
export function validatePhotoUpload(file: {
  type?: unknown;
  size?: unknown;
}): UploadValidation {
  if (typeof file.size !== "number" || file.size <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (!isAllowedPhotoType(file.type)) return { ok: false, reason: "type" };
  if (!isWithinSizeLimit(file.size)) return { ok: false, reason: "size" };
  return { ok: true };
}

/** A short, plain-language message for a failed validation reason. */
export function uploadErrorMessage(
  reason: "type" | "size" | "empty",
): string {
  switch (reason) {
    case "type":
      return "Unsupported file type. Please upload a JPG, PNG, WebP, or GIF image.";
    case "size":
      return `That image is too large. Please keep each photo under ${formatBytes(
        MAX_PHOTO_BYTES,
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
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

/**
 * The object path inside the bucket. The FIRST segment is the org id — the
 * storage RLS write policies (migration 0019) gate on exactly that segment, so
 * a user can only write under their own org's folder. The photo id keeps names
 * unique and unguessable.
 */
export function photoStoragePath(
  orgId: string,
  propertyId: string,
  photoId: string,
  ext: string,
): string {
  return `${orgId}/${propertyId}/${photoId}.${ext}`;
}

// ---------------------------------------------------------------------------
// Ordering + cover rules (operated on the minimal shape we read back)
// ---------------------------------------------------------------------------

export type PhotoLike = {
  id: string;
  sort_order: number;
  is_cover: boolean;
};

/** Stable display order: cover first, then ascending sort_order, then id. */
export function sortPhotos<T extends PhotoLike>(photos: T[]): T[] {
  return [...photos].sort((a, b) => {
    if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The sort_order to assign the next uploaded photo (append to the end). */
export function nextSortOrder(photos: { sort_order: number }[]): number {
  if (photos.length === 0) return 0;
  return Math.max(...photos.map((p) => p.sort_order)) + 1;
}

/**
 * Move one photo up or down by one position in display order and return the
 * full set of {id, sort_order} pairs to persist (re-indexed 0..n-1 so order is
 * always dense and unambiguous). A no-op (already at the edge) returns the
 * current order re-indexed. Cover state is untouched by reordering.
 */
export function reorder(
  photos: PhotoLike[],
  id: string,
  direction: "up" | "down",
): { id: string; sort_order: number }[] {
  // Reorder by raw sort_order (NOT cover-first) so cover doesn't pin position.
  const ordered = [...photos].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const idx = ordered.findIndex((p) => p.id === id);
  if (idx !== -1) {
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith >= 0 && swapWith < ordered.length) {
      [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
    }
  }
  return ordered.map((p, i) => ({ id: p.id, sort_order: i }));
}

/**
 * Make `id` the cover. Returns the id->is_cover pairs that CHANGE (so callers
 * issue minimal updates): the new cover becomes true, any other current cover
 * becomes false. If `id` isn't present, returns [] (no change).
 */
export function withCover(
  photos: PhotoLike[],
  id: string,
): { id: string; is_cover: boolean }[] {
  if (!photos.some((p) => p.id === id)) return [];
  const changes: { id: string; is_cover: boolean }[] = [];
  for (const p of photos) {
    const shouldBeCover = p.id === id;
    if (p.is_cover !== shouldBeCover) {
      changes.push({ id: p.id, is_cover: shouldBeCover });
    }
  }
  return changes;
}

/**
 * After deleting `deletedId`, decide which remaining photo (if any) should be
 * promoted to cover. Only promotes when the deleted photo WAS the cover and at
 * least one photo remains; the survivor with the lowest sort_order wins.
 * Returns the id to promote, or null (no promotion needed).
 */
export function coverAfterDelete(
  photos: PhotoLike[],
  deletedId: string,
): string | null {
  const deleted = photos.find((p) => p.id === deletedId);
  if (!deleted || !deleted.is_cover) return null;
  const remaining = photos.filter((p) => p.id !== deletedId);
  if (remaining.length === 0) return null;
  const first = sortPhotos(
    remaining.map((p) => ({ ...p, is_cover: false })),
  )[0];
  return first.id;
}
