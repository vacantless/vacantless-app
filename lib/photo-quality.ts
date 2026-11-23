// S832c (Noam 2026-11-23): flag a rental photo that looks dark or blurry, so a
// landlord can retake it before it goes in an ad. Pure: works on a greyscale
// buffer at about 512 px on the long side (lib/photo-quality-server.ts makes it).
//
// Calibrated 2026-11-23 on 50 live rental photos (Agile, Davis, Lakeview; phone
// shots and pro shoots), measured at 512 px:
//  - 95th-percentile brightness of real photos: 135 to 255. A dark door fills
//    most of a frame but the wall beside it stays bright, so a plain average
//    would flag good photos (two of the 50 averaged 75 and 91). Dark means the
//    BRIGHT parts are dim too: p95 under 110.
//  - Laplacian variance of real photos: 192 to 5340; the lowest were crisp,
//    clean white rooms. A 1 px blur drops a 200 photo to about 10 and a dark
//    door shot from 576 to 35. Blurry: under 60.
// Neither threshold flagged any of the 50 real photos.

export const QUALITY = {
  longSide: 512,
  darkP95Below: 110,
  blurLapVarBelow: 60,
} as const;

export type PhotoQualityFlag = "dark" | "blurry" | "dark_blurry";

export type PhotoQualityMetrics = { p95: number; lapVar: number };

export function photoQualityMetrics(gray: Uint8Array | Uint8ClampedArray, width: number, height: number): PhotoQualityMetrics {
  const n = width * height;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) hist[gray[i] ?? 0]++;
  let acc = 0;
  let p95 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= 0.95 * n) {
      p95 = v;
      break;
    }
  }
  let count = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += l;
      sum2 += l * l;
      count++;
    }
  }
  const mean = count ? sum / count : 0;
  const lapVar = count ? sum2 / count - mean * mean : 0;
  return { p95, lapVar: Math.round(lapVar) };
}

export function photoQualityFlag(m: PhotoQualityMetrics): PhotoQualityFlag | null {
  const dark = m.p95 < QUALITY.darkP95Below;
  const blurry = m.lapVar < QUALITY.blurLapVarBelow;
  if (dark && blurry) return "dark_blurry";
  if (dark) return "dark";
  if (blurry) return "blurry";
  return null;
}

/** The short label on the photo, e.g. "Looks dark". */
export function photoQualityLabel(flag: PhotoQualityFlag | null | undefined): string | null {
  if (flag === "dark") return "Looks dark";
  if (flag === "blurry") return "Looks blurry";
  if (flag === "dark_blurry") return "Dark and blurry";
  return null;
}

/** The one line above the photos when any is flagged. */
export function photoQualityLine(flags: readonly (PhotoQualityFlag | null | undefined)[], coverFlagged: boolean): string | null {
  const n = flags.filter(Boolean).length;
  if (n === 0) return null;
  const which = n === 1 ? "1 photo looks" : `${n} photos look`;
  const cover = coverFlagged ? " Your cover photo is one of them: it is the first thing renters see." : "";
  return `${which} dark or blurry. Renters scroll past a listing with poor photos, so retake or replace ${n === 1 ? "it" : "them"} if you can.${cover}`;
}
