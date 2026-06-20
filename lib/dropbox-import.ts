// Pure, dependency-free helpers for importing rental photos from a Dropbox
// shared-folder link (REAL-WORLD-INTAKE item Q, Phase 2: cloud-folder import).
//
// Photo/tour vendors deliver to operators in many shapes, but operators file
// every delivery into Dropbox — typically
//   Real Estate > Listings > [Address] > [slug] > gallery/
// where gallery/ is a flat folder of `0NN-highres_0NN.jpg` images. So a Dropbox
// shared-folder link is the vendor-agnostic convergence point: enumerate it,
// download each image server-side, and store it like an upload.
//
// This module holds ONLY the deterministic rules (URL validation, which entries
// are images, sort order, nested-folder grouping). The impure parts — the
// Dropbox API calls (token, list_folder, get_shared_link_file), the size/timeout
// caps, and the magic-byte sniff after download — live in the server action and
// reuse lib/image-url-import's sniffImageType. Everything here is unit-tested in
// scripts/test-dropbox-import.ts. No Supabase / Next imports.

// ---------------------------------------------------------------------------
// Shared-folder URL validation
// ---------------------------------------------------------------------------

// Dropbox shared-FOLDER links take two forms:
//   modern: https://www.dropbox.com/scl/fo/<id>/<rand>?rlkey=...&dl=0
//   legacy: https://www.dropbox.com/sh/<id>/<rand>?dl=0
// A shared-FILE link (/scl/fi/ or /s/) is a single image — that's import-by-URL
// territory (Phase 1), not a folder, so we reject it here with a clear reason.
const DROPBOX_HOSTS = new Set(["dropbox.com", "www.dropbox.com"]);
const FOLDER_PATH_RE = /^\/(scl\/fo|sh)\//;
const FILE_PATH_RE = /^\/(scl\/fi|s)\//;

export type DropboxUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: "invalid" | "scheme" | "host" | "notfolder" };

/**
 * Validate one pasted Dropbox shared-folder link. Returns the canonical href to
 * hand to the Dropbox API (we keep the query string — `rlkey` is part of what
 * authorizes the link). A single-file share is rejected as "notfolder".
 */
export function parseDropboxFolderUrl(
  raw: string | null | undefined,
): DropboxUrlValidation {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "invalid" };
  }
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "scheme" };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!DROPBOX_HOSTS.has(host)) return { ok: false, reason: "host" };
  if (FILE_PATH_RE.test(u.pathname)) return { ok: false, reason: "notfolder" };
  if (!FOLDER_PATH_RE.test(u.pathname)) return { ok: false, reason: "notfolder" };
  return { ok: true, url: u.href };
}

// ---------------------------------------------------------------------------
// Which entries are images
// ---------------------------------------------------------------------------

// Match the renderable types the bucket accepts (lib/photos ALLOWED_PHOTO_TYPES).
// Dropbox metadata carries NO mime type, so the extension is the cheap filter;
// the magic-byte sniff after download stays the authority on the stored type.
export const DROPBOX_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
] as const;

/** True if a file name ends in a supported image extension (case-insensitive). */
export function isDropboxImageName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  const n = name.trim().toLowerCase();
  if (!n || n.startsWith(".")) return false; // skip .DS_Store and other dotfiles
  const dot = n.lastIndexOf(".");
  if (dot === -1 || dot === n.length - 1) return false;
  const ext = n.slice(dot + 1);
  return (DROPBOX_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

// The minimal shape we read back from a Dropbox list_folder entry.
export type DropboxEntry = {
  // ".tag" in the API response; renamed so it's a valid TS identifier.
  tag: "file" | "folder" | string;
  name: string;
  // Lowercased full path within the shared link, e.g. "/001-highres_001.jpg"
  // or, when recursive, "/unit 1/003-....jpg". Present on every entry.
  path_lower?: string;
  size?: number;
};

/** Keep only the image FILES (drops folders, dotfiles, non-image files). */
export function filterImageEntries(entries: DropboxEntry[]): DropboxEntry[] {
  return entries.filter(
    (e) => e.tag === "file" && isDropboxImageName(e.name),
  );
}

/** Folder entries directly under the listing root (multi-unit subfolders). */
export function subfolderNames(entries: DropboxEntry[]): string[] {
  return entries
    .filter((e) => e.tag === "folder" && typeof e.name === "string")
    .map((e) => e.name);
}

// ---------------------------------------------------------------------------
// Ordering — galleries are sequentially named `0NN-...`
// ---------------------------------------------------------------------------

/**
 * The leading integer in a gallery file name ("001-highres_001.jpg" -> 1), or
 * null when the name has no numeric prefix. This gives a free, stable photo
 * order (and photo 001 becomes the cover) straight from the vendor's naming.
 */
export function galleryOrderNum(name: string): number | null {
  const m = name.match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sort gallery entries for import: numerically by leading prefix first (so 2
 * sorts before 10, which a string sort gets wrong), then names without a prefix
 * after, alphabetically. Stable + deterministic. Does not mutate the input.
 */
export function sortGalleryEntries(entries: DropboxEntry[]): DropboxEntry[] {
  return [...entries].sort((a, b) => {
    const na = galleryOrderNum(a.name);
    const nb = galleryOrderNum(b.name);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    if (na !== null && nb === null) return -1;
    if (na === null && nb !== null) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Nested (multi-unit) grouping — a building share is one subfolder per unit
// plus an "Outside & Common Areas" folder. Pure helper for the multi-unit
// follow-on; slice 1 imports a single flat folder and uses subfolderNames() to
// detect + explain the nested case.
// ---------------------------------------------------------------------------

/**
 * Group recursive image entries by their first-level subfolder name under the
 * share root. `rootPathLower` is the list_folder root's path_lower ("" for a
 * share root). Files directly at the root are grouped under "" (the empty key).
 * Returns a Map preserving first-seen subfolder order.
 */
export function groupByFirstSubfolder(
  entries: DropboxEntry[],
  rootPathLower = "",
): Map<string, DropboxEntry[]> {
  const root = rootPathLower.toLowerCase().replace(/\/+$/, "");
  const out = new Map<string, DropboxEntry[]>();
  for (const e of entries) {
    if (e.tag !== "file") continue;
    const p = (e.path_lower ?? "").toLowerCase();
    let rel = p;
    if (root && p.startsWith(root + "/")) rel = p.slice(root.length);
    rel = rel.replace(/^\/+/, "");
    const slash = rel.indexOf("/");
    const key = slash === -1 ? "" : rel.slice(0, slash);
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Multi-unit subfolder selection (a building share is one subfolder per unit).
// When the operator points at the BUILDING folder rather than a single unit's
// gallery, slice-1 used to dead-end with "share the unit folder instead". The
// follow-on lets them pick a unit: enumerate the subfolders, the operator
// chooses one, and we import THAT subfolder into this rental. These helpers keep
// the Dropbox path-building deterministic and confirm a chosen unit against the
// folders actually present (so a stale/typo choice can't drive an API call).
// ---------------------------------------------------------------------------

/**
 * Resolve an operator's chosen unit subfolder against the folders actually
 * listed under the share root. Matches case-insensitively but RETURNS the
 * server-side spelling (Dropbox paths are case-preserving), so the import uses
 * the canonical name. Returns null when the choice is empty or not present —
 * the caller rejects it rather than guessing.
 */
export function normalizeSubfolderChoice(
  choice: string | null | undefined,
  allowed: string[],
): string | null {
  if (typeof choice !== "string") return null;
  const want = choice.trim().toLowerCase();
  if (!want) return null;
  for (const name of allowed) {
    if (typeof name === "string" && name.trim().toLowerCase() === want) {
      return name;
    }
  }
  return null;
}

/**
 * The `path` argument for a Dropbox list_folder call scoped to a shared link:
 * "" for the share root, or "/<subfolder>" for one unit's folder. The subfolder
 * is expected to be an already-resolved single segment (via
 * normalizeSubfolderChoice); a leading slash and surrounding whitespace are
 * tolerated and any trailing slash is dropped.
 */
export function dropboxListPath(subfolder?: string | null): string {
  if (typeof subfolder !== "string") return "";
  const seg = subfolder.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return seg ? `/${seg}` : "";
}

/**
 * The `path` for a get_shared_link_file fetch: "/<name>" for a file at the share
 * root, or "/<subfolder>/<name>" when importing from a unit subfolder. Both
 * segments come from Dropbox's own listing by this point, so this only joins
 * them into a clean, slash-normalized path.
 */
export function dropboxFilePath(
  subfolder: string | null | undefined,
  name: string,
): string {
  const file = String(name).trim().replace(/^\/+/, "");
  const seg =
    typeof subfolder === "string"
      ? subfolder.trim().replace(/^\/+/, "").replace(/\/+$/, "")
      : "";
  return seg ? `/${seg}/${file}` : `/${file}`;
}

// ---------------------------------------------------------------------------
// Result messaging
// ---------------------------------------------------------------------------

export type DropboxImportError =
  | "dropboxurl"
  | "dropboxauth"
  | "dropboxempty"
  | "dropboxnested"
  | "dropboxbadunit"
  | "dropboxmax"
  | "dropboxfailed";

/** Plain-language copy for a Dropbox-folder import failure (via ?photoerr=). */
export function dropboxImportErrorMessage(reason: string): string {
  switch (reason) {
    case "dropboxurl":
      return "That doesn't look like a Dropbox shared-folder link. In Dropbox, open the folder, choose Share, copy the link, and paste it here.";
    case "dropboxauth":
      return "Photo import from Dropbox isn't set up yet. Please try again later or use direct image links.";
    case "dropboxempty":
      return "No photos were found in that Dropbox folder. Make sure the link points at the folder of images (not a single file or a parent folder).";
    case "dropboxnested":
      return "That folder contains sub-folders rather than photos (for example one folder per unit). Choose the unit whose photos belong on this rental, or open that unit's folder in Dropbox and share its link.";
    case "dropboxbadunit":
      return "That unit folder couldn't be found in the shared link. Re-open the building folder and pick a unit from the list.";
    case "dropboxmax":
      return "That would go over this rental's photo limit. The folder has more photos than the remaining slots.";
    case "dropboxfailed":
      return "None of the photos in that Dropbox folder could be imported. Make sure the link is set so that anyone with the link can view.";
    default:
      return "Sorry, importing from Dropbox didn't work. Please try again.";
  }
}
