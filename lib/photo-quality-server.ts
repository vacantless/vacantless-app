// S832c: measure a photo for lib/photo-quality.ts with sharp. Server only.
// Never throws: a photo that cannot be read gets no flag.
import sharp from "sharp";
import { QUALITY, photoQualityFlag, photoQualityMetrics, type PhotoQualityFlag } from "@/lib/photo-quality";

export async function assessPhotoQuality(bytes: Uint8Array): Promise<PhotoQualityFlag | null> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
      .rotate()
      .resize(QUALITY.longSide, QUALITY.longSide, { fit: "inside", withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 1 || info.width < 3 || info.height < 3) return null;
    return photoQualityFlag(photoQualityMetrics(new Uint8Array(data), info.width, info.height));
  } catch {
    return null;
  }
}
