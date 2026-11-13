// S789b: pull a unit's photos from a Google Drive folder shared "anyone with
// the link" (PLAN-S788-UNIT-PROGRESS step 3). Pure: no network, no DB.
//
// How it reads a folder with no Google sign-in and no API key: Drive serves a
// plain HTML view of a link-shared folder at /embeddedfolderview?id=<folder>.
// Each entry is a div.flip-entry with id="entry-<fileId>", an <a> to
// /drive/folders/<id> (a subfolder) or /file/d/<id>/view (a file), and a
// div.flip-entry-title with the name. Each photo is then fetched through
// Drive's thumbnail link at 2400 px wide: a JPEG well under the 10 MB photo
// limit even when the original is a 20 MB pro shot, and plenty for an ad.
import { isDropboxImageName, sortGalleryEntries } from "./dropbox-import";

export type DriveFolderRef = { folderId: string; resourceKey: string | null };

export type DriveUrlValidation =
  | ({ ok: true } & DriveFolderRef)
  | { ok: false; reason: "invalid" | "host" | "notfolder" };

const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;

/** A Google Drive FOLDER link, in any of its pasted shapes. */
export function parseDriveFolderUrl(raw: unknown): DriveUrlValidation {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, reason: "invalid" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "invalid" };
  const host = u.hostname.toLowerCase();
  if (host !== "drive.google.com") return { ok: false, reason: "host" };
  const resourceKey = cleanResourceKey(u.searchParams.get("resourcekey"));
  // /drive/folders/<id>, /drive/u/1/folders/<id>, /drive/mobile/folders/<id>
  const m = u.pathname.match(/\/folders\/([^/?#]+)/);
  if (m && DRIVE_ID.test(m[1])) return { ok: true, folderId: m[1], resourceKey };
  // /embeddedfolderview?id=<id> and the old /open?id=<id>
  if (/^\/(embeddedfolderview|open)\/?$/.test(u.pathname)) {
    const id = u.searchParams.get("id") ?? "";
    if (DRIVE_ID.test(id)) return { ok: true, folderId: id, resourceKey };
  }
  if (/\/file\/d\//.test(u.pathname)) return { ok: false, reason: "notfolder" };
  return { ok: false, reason: "invalid" };
}

function cleanResourceKey(v: string | null): string | null {
  return v && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
}

/** Which provider a saved photo-folder link points at. */
export type PhotoSource = "gdrive" | "dropbox" | "other";
export function photoSourceOf(raw: unknown): PhotoSource | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  try {
    const host = new URL(s).hostname.toLowerCase();
    if (host === "drive.google.com") return "gdrive";
    if (host === "dropbox.com" || host === "www.dropbox.com") return "dropbox";
    return "other";
  } catch {
    return null;
  }
}

/** A photo-folder link worth saving: https, at most 1000 characters. */
export function cleanPhotoFolderUrl(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 1000) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function withKey(url: string, resourceKey: string | null): string {
  return resourceKey ? `${url}&resourcekey=${encodeURIComponent(resourceKey)}` : url;
}

export function embeddedFolderViewUrl(ref: DriveFolderRef): string {
  return withKey(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(ref.folderId)}`, ref.resourceKey);
}

/** The photo itself, as a JPEG at most 2400 px wide. */
export function driveThumbnailUrl(fileId: string, resourceKey: string | null): string {
  return withKey(`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2400`, resourceKey);
}

/** Hosts a Drive photo fetch may be redirected through. */
export function isDriveImageHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "drive.google.com" || h === "drive.usercontent.google.com" || h.endsWith(".googleusercontent.com");
}

export type DriveEntry = { id: string; name: string; kind: "file" | "folder" };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Read the entries out of an /embeddedfolderview page. */
export function parseEmbeddedFolderView(html: string): DriveEntry[] {
  const out: DriveEntry[] = [];
  const seen = new Set<string>();
  const parts = String(html ?? "").split(/<div class="flip-entry"/).slice(1);
  for (const part of parts) {
    const idm = part.match(/^\s+id="entry-([A-Za-z0-9_-]{10,100})"/);
    if (!idm || seen.has(idm[1])) continue;
    const titlem = part.match(/class="flip-entry-title">([^<]*)</);
    const hrefm = part.match(/<a href="([^"]*)"/);
    const href = hrefm ? hrefm[1] : "";
    const kind: DriveEntry["kind"] = /\/folders\//.test(href) ? "folder" : "file";
    seen.add(idm[1]);
    out.push({ id: idm[1], name: decodeEntities((titlem?.[1] ?? "").trim()), kind });
  }
  return out;
}

/** The image files in a folder, in gallery order (001, 002, ... then by name). */
export function driveImages(entries: readonly DriveEntry[]): DriveEntry[] {
  const imgs = entries.filter((e) => e.kind === "file" && isDropboxImageName(e.name));
  const sorted = sortGalleryEntries(imgs.map((e) => ({ tag: "file", name: e.name, path_lower: e.id })));
  const byId = new Map(imgs.map((e) => [e.id, e]));
  return sorted.map((s) => byId.get(s.path_lower as string) as DriveEntry);
}

export const DRIVE_SOURCE_PREFIX = "gdrive:";
export function driveSourceRef(fileId: string): string {
  return `${DRIVE_SOURCE_PREFIX}${fileId}`;
}

/** Photos not pulled in yet, at most `room` of them. */
export function photosToPull(images: readonly DriveEntry[], alreadyPulled: ReadonlySet<string>, room: number): DriveEntry[] {
  if (room <= 0) return [];
  return images.filter((e) => !alreadyPulled.has(driveSourceRef(e.id))).slice(0, room);
}

export type DrivePullReason = "badlink" | "notshared" | "empty" | "nested" | "full" | "failed";

export type DrivePullResult =
  | { ok: true; added: number; skipped: number; alreadyIn: number }
  | { ok: false; reason: DrivePullReason; subfolders?: string[] };

/** One plain line for the landlord's email or the page. */
export function drivePullLine(r: DrivePullResult): string {
  if (r.ok) {
    if (r.added === 0) return r.alreadyIn > 0 ? "Every photo in the folder is already on the rental." : "No new photos in the folder.";
    const skip = r.skipped > 0 ? ` ${r.skipped} could not be read.` : "";
    return `${r.added} photo${r.added === 1 ? "" : "s"} pulled in from the folder.${skip}`;
  }
  switch (r.reason) {
    case "badlink":
      return "The photo folder link is not a Google Drive folder link.";
    case "notshared":
      return "The photo folder could not be opened. In Google Drive, set it to Anyone with the link can view.";
    case "empty":
      return "The photo folder has no photos yet.";
    case "nested":
      return `The photo folder holds folders, not photos.${r.subfolders?.length ? ` It has ${r.subfolders.slice(0, 4).join(", ")}.` : ""} Use the link of the folder with this unit's photos.`;
    case "full":
      return "The rental already has as many photos as the plan allows.";
    default:
      return "None of the photos could be pulled in. Check the folder is shared with Anyone with the link.";
  }
}
