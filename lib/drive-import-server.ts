// S789b: pull a unit's photos from its Google Drive folder (lib/drive-import
// has the rules). Server only. Used by the crew "Photos are in" tap and the
// landlord's "Pull photos now" on the rental page. New photos only: each one
// remembers its Drive file id (property_photos.source_ref), so pressing again
// adds what is new and never doubles a photo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PHOTO_BYTES, extForType, nextSortOrder, photoStoragePath, type PhotoLike } from "@/lib/photos";
import { sniffImageType } from "@/lib/image-url-import";
import { photoCapForPlan } from "@/lib/billing";
import {
  driveImages,
  driveSourceRef,
  driveThumbnailUrl,
  embeddedFolderViewUrl,
  isDriveImageHost,
  parseDriveFolderUrl,
  parseEmbeddedFolderView,
  photosToPull,
  type DriveEntry,
  type DriveFolderRef,
  type DrivePullResult,
} from "@/lib/drive-import";

const PHOTO_BUCKET = "property-photos";
const LIST_TIMEOUT_MS = 15_000;
const PHOTO_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;
const CONCURRENCY = 4;

async function fetchText(url: string): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(LIST_TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 Vacantless" } });
    if (res.status >= 300 && res.status < 400) return { status: res.status, text: "" };
    return { status: res.status, text: res.ok ? await res.text() : "" };
  } catch {
    return null;
  }
}

/** The folder's entries, or null when Drive will not show it without a sign-in. */
export async function listDriveFolder(ref: DriveFolderRef): Promise<DriveEntry[] | null> {
  const page = await fetchText(embeddedFolderViewUrl(ref));
  if (!page || page.status !== 200) return null;
  // A private folder answers with a sign-in page, not the folder view.
  if (!/flip-entry|class="flip-entries"/.test(page.text) && !/folder-view/.test(page.text)) return null;
  return parseEmbeddedFolderView(page.text);
}

/** One photo's bytes, following redirects only through Google's own hosts. */
export async function fetchDriveImage(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !isDriveImageHost(u.hostname)) return null;
    let res: Response;
    try {
      res = await fetch(u.href, { redirect: "manual", signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 Vacantless" } });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, u.href).href;
      continue;
    }
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_PHOTO_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_PHOTO_BYTES) return null;
    const type = sniffImageType(buf);
    return type ? { bytes: buf, type } : null;
  }
  return null;
}

/**
 * Pull the new photos from a unit's Drive folder onto the rental. If the
 * folder holds only folders, and exactly one of them holds photos, that one
 * is used; otherwise the landlord is asked for the unit's own folder.
 */
export async function pullDrivePhotos(args: {
  admin: SupabaseClient;
  organizationId: string;
  propertyId: string;
  folderUrl: string;
}): Promise<DrivePullResult> {
  const { admin, organizationId, propertyId } = args;
  const ref = parseDriveFolderUrl(args.folderUrl);
  if (!ref.ok) return { ok: false, reason: "badlink" };

  const entries = await listDriveFolder(ref);
  if (entries === null) return { ok: false, reason: "notshared" };
  let images = driveImages(entries);
  let resourceKey = ref.resourceKey;
  if (images.length === 0) {
    const folders = entries.filter((e) => e.kind === "folder");
    if (folders.length === 0) return { ok: false, reason: "empty" };
    const withPhotos: Array<{ name: string; images: DriveEntry[] }> = [];
    for (const f of folders.slice(0, 12)) {
      const inner = await listDriveFolder({ folderId: f.id, resourceKey: null });
      const imgs = inner ? driveImages(inner) : [];
      if (imgs.length > 0) withPhotos.push({ name: f.name, images: imgs });
    }
    if (withPhotos.length !== 1) return { ok: false, reason: "nested", subfolders: folders.map((f) => f.name) };
    images = withPhotos[0].images;
    resourceKey = null;
  }

  const { data: org } = await admin.from("organizations").select("plan").eq("id", organizationId).maybeSingle();
  const plan = (org as { plan: string | null } | null)?.plan ?? null;
  const { data: existing } = await admin
    .from("property_photos")
    .select("id, sort_order, is_cover, source_ref")
    .eq("property_id", propertyId)
    .eq("organization_id", organizationId);
  const rows = (existing ?? []) as Array<PhotoLike & { source_ref: string | null }>;
  const pulled = new Set(rows.map((r) => r.source_ref).filter((s): s is string => !!s));
  const alreadyIn = images.filter((e) => pulled.has(driveSourceRef(e.id))).length;
  const room = photoCapForPlan(plan) - rows.length;
  const todo = photosToPull(images, pulled, room);
  if (todo.length === 0) {
    if (alreadyIn < images.length && room <= 0) return { ok: false, reason: "full" };
    return { ok: true, added: 0, skipped: 0, alreadyIn };
  }

  // Fetch a few at a time, then store in gallery order.
  const fetched: Array<{ entry: DriveEntry; img: { bytes: Uint8Array; type: string } | null }> = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map((e) => fetchDriveImage(driveThumbnailUrl(e.id, resourceKey))));
    batch.forEach((entry, j) => fetched.push({ entry, img: got[j] }));
  }

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
    const path = photoStoragePath(organizationId, propertyId, photoId, extForType(img.type));
    const { error: upErr } = await admin.storage.from(PHOTO_BUCKET).upload(path, img.bytes, { contentType: img.type, upsert: false });
    if (upErr) {
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
      source_ref: driveSourceRef(entry.id),
    });
    if (insErr) {
      await admin.storage.from(PHOTO_BUCKET).remove([path]);
      skipped++;
      continue;
    }
    order++;
    firstEver = false;
    added++;
  }
  if (added === 0) return { ok: false, reason: "failed" };
  return { ok: true, added, skipped, alreadyIn };
}
