import { buildZip, type ZipEntry } from "@/lib/zip";
import { sortPhotos } from "@/lib/photos";
import {
  MARKETPLACE_KIT_MAX_PHOTOS,
  marketplacePhotoFileName,
  marketplacePhotosZipName,
} from "@/lib/marketplace-kit";

// S712: one zip of a rental's photos for the Marketplace kit, in display order
// (cover first). Photos live in the PUBLIC property-photos bucket, so we fetch
// their public URLs. Only URLs inside our own bucket are fetched (a stored URL
// can never make the server fetch somewhere else). A photo that fails to load
// is skipped rather than failing the whole download.

type KitPhoto = { id: string; url: string; sort_order: number; is_cover: boolean };

function isOwnBucketUrl(url: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return false;
  return url.startsWith(`${base}/storage/v1/object/public/property-photos/`);
}

export async function marketplacePhotosZipResponse(
  photos: KitPhoto[],
  address: string | null,
): Promise<Response> {
  const ordered = sortPhotos(photos)
    .filter((p) => isOwnBucketUrl(p.url))
    .slice(0, MARKETPLACE_KIT_MAX_PHOTOS);
  if (ordered.length === 0) {
    return new Response("This rental has no photos yet.", { status: 404 });
  }
  const fetched = await Promise.all(
    ordered.map(async (p, i): Promise<ZipEntry | null> => {
      try {
        const res = await fetch(p.url, { cache: "no-store" });
        if (!res.ok) return null;
        return { name: marketplacePhotoFileName(i, p.url), data: new Uint8Array(await res.arrayBuffer()) };
      } catch {
        return null;
      }
    }),
  );
  const entries = fetched.filter((e): e is ZipEntry => e !== null);
  if (entries.length === 0) {
    return new Response("The photos could not be loaded. Try again in a minute.", { status: 502 });
  }
  const zip = buildZip(entries, new Date().toISOString());
  return new Response(Buffer.from(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${marketplacePhotosZipName(address)}"`,
      "Cache-Control": "no-store",
    },
  });
}
