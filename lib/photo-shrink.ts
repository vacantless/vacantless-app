// S827b: photos picked on Add rental ride the save as one upload, and the host
// refuses anything over about 4.5 MB in total. Ten photographer files (23 MB)
// failed with no message at all. We make each photo smaller in the browser so
// the whole set fits, and say so. Pure planning here; the canvas work is in
// shrinkPhotos, which only runs in a browser.

/** Total we allow for all photos in one save, under the host's 4.5 MB cap. */
export const PHOTO_SAVE_BUDGET_BYTES = Math.floor(3.6 * 1024 * 1024);
/** Below this a listing photo looks poor, so we keep fewer photos instead. */
export const PHOTO_MIN_BYTES = 230 * 1024;

export type PhotoShrinkPlan = { keep: number; perFileBytes: number; left: number };

export function photoShrinkPlan(count: number): PhotoShrinkPlan {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return { keep: 0, perFileBytes: 0, left: 0 };
  const most = Math.max(1, Math.floor(PHOTO_SAVE_BUDGET_BYTES / PHOTO_MIN_BYTES));
  const keep = Math.min(n, most);
  return { keep, perFileBytes: Math.floor(PHOTO_SAVE_BUDGET_BYTES / keep), left: n - keep };
}

/** Longest edge and JPEG quality to try, best first. */
export const PHOTO_SHRINK_STEPS: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: 2000, quality: 0.85 },
  { edge: 1600, quality: 0.8 },
  { edge: 1400, quality: 0.74 },
  { edge: 1200, quality: 0.68 },
  { edge: 1024, quality: 0.6 },
];

export function photoShrinkMessage(kept: number, left: number, failed: number): string {
  const parts: string[] = [];
  if (kept > 0) parts.push(`${kept} photo${kept === 1 ? "" : "s"} ready. We made them smaller so they save fast.`);
  if (left > 0) parts.push(`${left} more did not fit. Add ${left === 1 ? "it" : "them"} on the rental's page after you save.`);
  if (failed > 0) parts.push(`${failed} could not be read. Use JPG or PNG photos.`);
  return parts.join(" ");
}

async function shrinkOne(file: File, maxBytes: number): Promise<File | null> {
  if (!/^image\//.test(file.type)) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file.size <= maxBytes ? file : null;
  }
  try {
    for (const step of PHOTO_SHRINK_STEPS) {
      const scale = Math.min(1, step.edge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      if (scale === 1 && file.size <= maxBytes) return file;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", step.quality),
      );
      if (blob && blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
      }
    }
  } finally {
    bitmap.close?.();
  }
  return null;
}

/** Browser only. Returns the files to save and the line to show the landlord. */
export async function shrinkPhotos(files: File[]): Promise<{ files: File[]; message: string }> {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (files.length === 0) return { files: [], message: "" };
  if (total <= PHOTO_SAVE_BUDGET_BYTES) return { files, message: "" };
  const plan = photoShrinkPlan(files.length);
  const out: File[] = [];
  let failed = 0;
  for (const file of files.slice(0, plan.keep)) {
    const small = await shrinkOne(file, plan.perFileBytes);
    if (small) out.push(small);
    else failed++;
  }
  return { files: out, message: photoShrinkMessage(out.length, plan.left, failed) };
}

/** S827b: shown by Save draft when the photos are too big to send at all. */
export function tooBigToSaveMessage(bytes: number): string {
  const mb = Math.max(1, Math.round(bytes / (1024 * 1024)));
  return `Not saved yet. Your photos add up to ${mb} MB, more than one save can carry. Remove some photos, or save without photos and add them on the rental's page.`;
}

/** S827b: shown when the save stopped and the page never moved on. */
export function saveFailedMessage(): string {
  return "Your rental did not save. Nothing was created. Large photos are the usual cause: remove the photos, save, then add them on the rental's page. If it fails again, try once more in a minute.";
}
