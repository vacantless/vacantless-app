// S791b: Dropbox shared-folder access, moved out of app/dashboard/properties/
// actions.ts (S254 import) so the crew link, the photographer link and the
// rental page can all pull from a Dropbox folder with the service-role
// client. Same rules as the Drive pull (lib/drive-import-server): only new
// photos, the plan's photo cap, touch-up for crew shots with originals kept.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PHOTO_BYTES, extForType, nextSortOrder, photoStoragePath, type PhotoLike } from "@/lib/photos";
import { sniffImageType } from "@/lib/image-url-import";
import { photoCapForPlan } from "@/lib/billing";
import { touchUpPhoto } from "@/lib/photo-touchup";
import { groupImagesByParentPath, parseDropboxFolderUrl, sortGalleryEntries, type DropboxEntry } from "@/lib/dropbox-import";
import type { DrivePullResult } from "@/lib/drive-import";

const IMPORT_FETCH_TIMEOUT_MS = 10_000;
const PHOTO_BUCKET = "property-photos";
const CONCURRENCY = 4;

export type FetchedImage = { bytes: Uint8Array; type: string };

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_API = "https://content.dropboxapi.com/2";

/** Escape non-ASCII so a file name is safe inside the Dropbox-API-Arg header. */
function dropboxApiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/**
 * Resolve a Dropbox access token for OUR service account. Prefers a long-lived
 * OAuth refresh token (DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY/SECRET) exchanged
 * server-side for a short-lived access token; falls back to a directly-supplied
 * DROPBOX_ACCESS_TOKEN (the App-Console token used for the first prove-out).
 * Returns null when unconfigured so the action shows a clean "not set up" note.
 */
export async function getDropboxAccessToken(): Promise<string | null> {
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;
  if (refresh && key && secret) {
    try {
      const auth = Buffer.from(`${key}:${secret}`).toString("base64");
      const res = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { access_token?: string };
      return json.access_token ?? null;
    } catch {
      return null;
    }
  }
  const direct = process.env.DROPBOX_ACCESS_TOKEN;
  return direct && direct.trim() ? direct.trim() : null;
}

type DropboxApiEntry = {
  ".tag"?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
};
type DropboxListResponse = {
  entries?: DropboxApiEntry[];
  cursor?: string;
  has_more?: boolean;
};

function collectDropboxEntries(
  json: DropboxListResponse,
  out: DropboxEntry[],
): void {
  for (const e of json.entries ?? []) {
    if (typeof e.name !== "string") continue;
    out.push({
      tag: typeof e[".tag"] === "string" ? (e[".tag"] as string) : "",
      name: e.name,
      path_lower: e.path_lower,
      path_display: e.path_display,
      size: e.size,
    });
  }
}

// Caps so an operator who pastes a huge top-level folder can't make us walk
// forever. A real single-listing archive is well under both, even across years.
const DROPBOX_MAX_ENTRIES = 5000;
const DROPBOX_MAX_FOLDERS = 200; // how many subfolders the tree walk will visit
const DROPBOX_WALK_CONCURRENCY = 8; // sibling folders listed at once

/**
 * Enumerate the entries directly under one level of a Dropbox shared folder
 * (NON-recursive — `path` is "" for the share root or "/a/b" for a subfolder).
 * Dropbox does not allow `recursive: true` together with a `shared_link`, so the
 * deep walk is done by dropboxListSharedTree calling this per folder. Paginates
 * via list_folder/continue and stops at DROPBOX_MAX_ENTRIES. Null on API error.
 */
async function dropboxListSharedFolder(
  token: string,
  shareUrl: string,
  path = "",
): Promise<DropboxEntry[] | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const entries: DropboxEntry[] = [];
  try {
    let res = await fetch(`${DROPBOX_API}/files/list_folder`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path, shared_link: { url: shareUrl } }),
    });
    if (!res.ok) return null;
    let json = (await res.json()) as DropboxListResponse;
    collectDropboxEntries(json, entries);
    let guard = 0;
    while (
      json.has_more &&
      json.cursor &&
      guard < 50 &&
      entries.length < DROPBOX_MAX_ENTRIES
    ) {
      guard += 1;
      res = await fetch(`${DROPBOX_API}/files/list_folder/continue`, {
        method: "POST",
        headers,
        body: JSON.stringify({ cursor: json.cursor }),
      });
      if (!res.ok) return null;
      json = (await res.json()) as DropboxListResponse;
      collectDropboxEntries(json, entries);
    }
  } catch {
    return null;
  }
  return entries;
}

/**
 * Walk a whole Dropbox shared folder breadth-first using the per-level lister
 * above (since Dropbox blocks recursive listing on shared links). Returns every
 * entry found across the tree — files (with their full path_display) and the
 * folders we descended — so the caller can group images by their parent folder.
 * Bounded by DROPBOX_MAX_FOLDERS / DROPBOX_MAX_ENTRIES; sibling folders are
 * listed DROPBOX_WALK_CONCURRENCY at a time to keep wall-time low. Null only
 * when the ROOT listing fails (a private/expired link); a single subfolder that
 * errors mid-walk is skipped best-effort.
 */
export async function dropboxListSharedTree(
  token: string,
  shareUrl: string,
): Promise<DropboxEntry[] | null> {
  // List one level and stamp every entry with a path we KNOW is relative to the
  // share root, built from the parent's relative path + the entry name. Dropbox's
  // own path_display is unreliable for a shared link we don't own (it can be the
  // owner's absolute account path), so we never trust it for descent/download —
  // we overwrite it with our computed value and use that everywhere downstream.
  const visit = async (relParent: string): Promise<DropboxEntry[] | null> => {
    const entries = await dropboxListSharedFolder(token, shareUrl, relParent);
    if (entries === null) return null;
    for (const e of entries) {
      e.path_display = `${relParent}/${e.name}`; // relParent is "" at the root
    }
    return entries;
  };

  const root = await visit("");
  if (root === null) return null;

  const all: DropboxEntry[] = [...root];
  let frontier = root
    .filter((e) => e.tag === "folder")
    .map((e) => e.path_display as string);
  let visited = 0;

  while (
    frontier.length > 0 &&
    visited < DROPBOX_MAX_FOLDERS &&
    all.length < DROPBOX_MAX_ENTRIES
  ) {
    const batch = frontier.slice(0, DROPBOX_MAX_FOLDERS - visited);
    visited += batch.length;
    const next: string[] = [];
    for (let i = 0; i < batch.length; i += DROPBOX_WALK_CONCURRENCY) {
      const chunk = batch.slice(i, i + DROPBOX_WALK_CONCURRENCY);
      const results = await Promise.all(chunk.map((p) => visit(p)));
      for (const entries of results) {
        if (!entries) continue; // best-effort: skip a folder that errors
        for (const e of entries) {
          all.push(e);
          if (e.tag === "folder") next.push(e.path_display as string);
        }
      }
    }
    frontier = next;
  }
  return all;
}

/**
 * Download one file from under the shared link by its path relative to the share
 * root ("/<name>" for a root file, "/<unit>/<name>" for a unit subfolder).
 * Streams with the same size + timeout caps as the URL importer, then confirms
 * the bytes are a supported image via the magic-byte sniff. Returns null on any
 * failure (best-effort per file).
 */
export async function fetchDropboxSharedFile(
  token: string,
  shareUrl: string,
  filePath: string,
): Promise<FetchedImage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${DROPBOX_CONTENT_API}/sharing/get_shared_link_file`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxApiArg({ url: shareUrl, path: filePath }),
        },
        signal: controller.signal,
      },
    );
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_PHOTO_BYTES) {
          await reader.cancel();
          clearTimeout(timer);
          return null;
        }
        chunks.push(value);
      }
    }
    clearTimeout(timer);
    if (total <= 0) return null;
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    const type = sniffImageType(bytes);
    if (!type) return null;
    return { bytes, type };
  } catch {
    clearTimeout(timer);
    return null;
  }
}


/** The source_ref a pulled Dropbox photo carries, so a second pull skips it. */
export function dropboxSourceRef(relPath: string): string {
  return `dropbox:${relPath.toLowerCase()}`;
}

/**
 * Pull the photos in a unit's Dropbox folder that are not on the rental yet.
 * A share with one folder of photos (at the root or one subfolder) is used;
 * several photo folders ask for the unit's own folder. Never throws.
 */
export async function pullDropboxPhotos(args: {
  admin: SupabaseClient;
  organizationId: string;
  propertyId: string;
  folderUrl: string;
  touchUp?: boolean;
}): Promise<DrivePullResult> {
  const { admin, organizationId, propertyId } = args;
  const parsed = parseDropboxFolderUrl(args.folderUrl);
  if (!parsed.ok) return { ok: false, reason: "badlink" };
  const token = await getDropboxAccessToken();
  if (!token) {
    console.error("[dropbox-pull] no Dropbox token set");
    return { ok: false, reason: "failed" };
  }
  const entries = await dropboxListSharedTree(token, parsed.url);
  if (entries === null) return { ok: false, reason: "notshared" };
  const groups = groupImagesByParentPath(entries);
  if (groups.size === 0) {
    return entries.some((e) => e.tag === "folder") ? { ok: false, reason: "nested", subfolders: [] } : { ok: false, reason: "empty" };
  }
  if (groups.size > 1) {
    return { ok: false, reason: "nested", subfolders: [...groups.keys()].map((k) => k || "the top folder") };
  }
  const images = sortGalleryEntries([...groups.values()][0]);

  const { data: org } = await admin.from("organizations").select("plan").eq("id", organizationId).maybeSingle();
  const plan = (org as { plan: string | null } | null)?.plan ?? null;
  const { data: existing } = await admin
    .from("property_photos")
    .select("id, sort_order, is_cover, source_ref")
    .eq("property_id", propertyId)
    .eq("organization_id", organizationId);
  const rows = (existing ?? []) as Array<PhotoLike & { source_ref: string | null }>;
  const pulled = new Set(rows.map((r) => r.source_ref).filter((s): s is string => !!s));
  const refOf = (e: DropboxEntry) => dropboxSourceRef(e.path_display ?? `/${e.name}`);
  const alreadyIn = images.filter((e) => pulled.has(refOf(e))).length;
  const room = Math.max(0, photoCapForPlan(plan) - rows.length);
  const todo = images.filter((e) => !pulled.has(refOf(e))).slice(0, room);
  if (todo.length === 0) {
    if (alreadyIn < images.length && room <= 0) return { ok: false, reason: "full" };
    return { ok: true, added: 0, skipped: 0, alreadyIn };
  }

  const fetched: Array<{ entry: DropboxEntry; img: FetchedImage | null }> = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map((e) => fetchDropboxSharedFile(token, parsed.url, e.path_display ?? `/${e.name}`)));
    batch.forEach((entry, j) => fetched.push({ entry, img: got[j] }));
  }

  const misses: string[] = [];
  let order = nextSortOrder(rows);
  let firstEver = rows.length === 0;
  let added = 0;
  let skipped = 0;
  for (const { entry, img } of fetched) {
    if (!img) {
      skipped++;
      continue;
    }
    const photoId = crypto.randomUUID();
    const edited = args.touchUp ? await touchUpPhoto(img.bytes) : null;
    const path = photoStoragePath(organizationId, propertyId, photoId, edited ? "jpg" : extForType(img.type));
    let originalPath: string | null = null;
    let originalUrl: string | null = null;
    if (edited) {
      originalPath = photoStoragePath(organizationId, propertyId, `${photoId}-original`, extForType(img.type));
      const { error: origErr } = await admin.storage.from(PHOTO_BUCKET).upload(originalPath, img.bytes, { contentType: img.type, upsert: false });
      if (origErr) {
        if (misses.length < 10) misses.push(`storage ${origErr.message}`);
        skipped++;
        continue;
      }
      originalUrl = admin.storage.from(PHOTO_BUCKET).getPublicUrl(originalPath).data.publicUrl;
    }
    const { error: upErr } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(path, edited ?? img.bytes, { contentType: edited ? "image/jpeg" : img.type, upsert: false });
    if (upErr) {
      if (misses.length < 10) misses.push(`storage ${upErr.message}`);
      if (originalPath) await admin.storage.from(PHOTO_BUCKET).remove([originalPath]);
      skipped++;
      continue;
    }
    const { data: pub } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    const { error: insErr } = await admin.from("property_photos").insert({
      id: photoId,
      organization_id: organizationId,
      property_id: propertyId,
      storage_path: path,
      url: pub.publicUrl,
      sort_order: order,
      is_cover: firstEver,
      source_ref: refOf(entry),
      touched_up: !!edited,
      original_storage_path: originalPath,
      original_url: originalUrl,
    });
    if (insErr) {
      if (misses.length < 10) misses.push(`insert ${insErr.message}`);
      await admin.storage.from(PHOTO_BUCKET).remove(originalPath ? [path, originalPath] : [path]);
      skipped++;
      continue;
    }
    order++;
    firstEver = false;
    added++;
  }
  if (skipped > 0) console.warn("[dropbox-pull] some photos missed", { propertyId, skipped, added, first: misses.slice(0, 3) });
  if (added === 0) return { ok: false, reason: "failed" };
  return { ok: true, added, skipped, alreadyIn };
}
