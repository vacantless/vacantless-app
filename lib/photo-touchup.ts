// S789e: automatic photo touch-up for crew photos (PLAN-S788-UNIT-PROGRESS
// step 4, Noam 2026-11-13: automatic, originals kept so a bad edit can be
// undone). Server only (sharp).
//
// What it does, gently, the way a listing photo editor would on a phone shot:
//   1. turns the photo the right way up from its camera tag;
//   2. lifts the shadows and eases the highlights (dark corners open up, the
//      ceiling by a light does not blow out);
//   3. lifts brightness a little and colour a touch;
//   4. sharpens lightly and saves a good-quality JPEG.
// Chosen 2026-11-13 by looking at Agile's own phone shots (833 Pillette Unit
// 36) side by side: a levels stretch made rooms darker and clipped lights;
// this lift reads brighter and more natural.
// What it does not do yet: straighten leaning walls (perspective). That needs
// line detection and is a later step.
import sharp from "sharp";

export const TOUCHUP = {
  /** out = in * contrast + lift: shadows up by about 28, highlights eased. */
  contrast: 0.92,
  lift: 28,
  brightness: 1.06,
  saturation: 1.06,
  sharpenSigma: 0.8,
  jpegQuality: 86,
} as const;

/** The touched-up JPEG, or null when the photo cannot be read. Never throws. */
export async function touchUpPhoto(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const out = await sharp(Buffer.from(bytes), { failOn: "none" })
      .rotate()
      .linear(TOUCHUP.contrast, TOUCHUP.lift)
      .modulate({ brightness: TOUCHUP.brightness, saturation: TOUCHUP.saturation })
      .sharpen({ sigma: TOUCHUP.sharpenSigma })
      .jpeg({ quality: TOUCHUP.jpegQuality, mozjpeg: true })
      .toBuffer();
    return out.byteLength > 0 ? new Uint8Array(out) : null;
  } catch {
    return null;
  }
}
