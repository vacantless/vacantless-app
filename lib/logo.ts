// Pure, dependency-free validation for the org-logo upload (block 2). Mirrors
// lib/photos but for a single brand logo stored in the `org-logos` Storage
// bucket. No Supabase / Next imports, so it is unit-tested directly with
// `npx tsx scripts/test-logo.ts`.
//
// Path convention: `<organization_id>/<file_id>.<ext>` — the FIRST segment is
// the org id, which migration 0020's storage policies gate on. One logo per
// org; the upload action clears the org's folder before writing a fresh file.

// SVG is allowed (logos are commonly vector). It is served as image/svg+xml
// from the Storage CDN origin and only ever rendered inside an <img> tag, which
// does not execute embedded script. These MUST match the bucket's
// allowed_mime_types in migration 0020.
export const ALLOWED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
export type AllowedLogoType = (typeof ALLOWED_LOGO_TYPES)[number];

// A logo is small; cap well below the photo limit. Matches the bucket's
// file_size_limit in migration 0020.
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export function isAllowedLogoType(type: unknown): type is AllowedLogoType {
  return (
    typeof type === "string" &&
    (ALLOWED_LOGO_TYPES as readonly string[]).includes(type)
  );
}

export function isWithinLogoSize(bytes: unknown): boolean {
  return typeof bytes === "number" && bytes > 0 && bytes <= MAX_LOGO_BYTES;
}

export type LogoUploadValidation =
  | { ok: true }
  | { ok: false; reason: "empty" | "type" | "size" };

/** Validate one selected logo file (anything with a .type + .size). */
export function validateLogoUpload(file: {
  type?: unknown;
  size?: unknown;
}): LogoUploadValidation {
  if (typeof file.size !== "number" || file.size <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (!isAllowedLogoType(file.type)) return { ok: false, reason: "type" };
  if (!isWithinLogoSize(file.size)) return { ok: false, reason: "size" };
  return { ok: true };
}

/** Plain-language message for a failed logo validation reason. */
export function logoUploadErrorMessage(
  reason: "empty" | "type" | "size",
): string {
  switch (reason) {
    case "empty":
      return "Choose a logo image to upload.";
    case "type":
      return "That file type isn't supported. Use a PNG, JPG, WebP, GIF, or SVG.";
    case "size":
      return "That logo is too large. Keep it under 2 MB.";
  }
}

export function extForLogoType(type: string): string {
  switch (type) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

/** `<org_id>/<file_id>.<ext>` — org id FIRST so the storage policy can gate it. */
export function logoStoragePath(
  orgId: string,
  fileId: string,
  ext: string,
): string {
  return `${orgId}/${fileId}.${ext}`;
}
