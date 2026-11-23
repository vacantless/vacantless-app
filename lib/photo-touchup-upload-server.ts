// S832c (Noam 2026-11-23): touch-up for photos uploaded straight to the rental,
// not only for folder pulls (S789e). The upload stays where the browser put it
// and becomes the kept original; the brightened copy is written beside it and
// becomes what the rental shows. "Use the originals" (switchPhotoTouchUp) swaps
// them back, like a folder pull. Server only (sharp). Never throws: any
// failure leaves the upload as it is, with no flag.
import type { SupabaseClient } from "@supabase/supabase-js";
import { touchUpPhoto } from "@/lib/photo-touchup";
import { photoStoragePath } from "@/lib/photos";
import { assessPhotoQuality } from "@/lib/photo-quality-server";
import type { PhotoQualityFlag } from "@/lib/photo-quality";

const PHOTO_BUCKET = "property-photos";

export type TouchedUpload = {
  storagePath: string;
  url: string;
  originalStoragePath: string;
  originalUrl: string;
};

/** The touched-up copy's path: the photo id with "-touched", always JPEG. */
export function touchedPathFor(orgId: string, propertyId: string, photoId: string): string {
  return photoStoragePath(orgId, propertyId, `${photoId}-touched`, "jpg");
}

export type ProcessedUpload = { touched: TouchedUpload | null; qualityFlag: PhotoQualityFlag | null };

/**
 * S832c: read the uploaded photo once, brighten it when asked, and check the
 * photo the rental will show for dark or blurry (lib/photo-quality.ts).
 */
export async function processUploadedPhoto(
  supabase: SupabaseClient,
  args: { orgId: string; propertyId: string; photoId: string; storagePath: string; touchUp: boolean },
): Promise<ProcessedUpload> {
  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(PHOTO_BUCKET).download(args.storagePath);
    if (dlErr || !blob) return { touched: null, qualityFlag: null };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const edited = args.touchUp ? await touchUpPhoto(bytes) : null;
    let touched: TouchedUpload | null = null;
    if (edited) {
      const path = touchedPathFor(args.orgId, args.propertyId, args.photoId);
      const { error: upErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, edited, { contentType: "image/jpeg", upsert: false });
      if (!upErr) {
        touched = {
          storagePath: path,
          url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
          originalStoragePath: args.storagePath,
          originalUrl: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(args.storagePath).data.publicUrl,
        };
      }
    }
    const qualityFlag = await assessPhotoQuality(touched && edited ? edited : bytes);
    return { touched, qualityFlag };
  } catch {
    return { touched: null, qualityFlag: null };
  }
}
