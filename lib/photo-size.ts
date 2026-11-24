// S839a (REVIEW-S839 finding 2): the public rental page sent every photo at
// camera size (10 photos, 22.7 MB on 50 Glenrose) to a renter's phone.
// Supabase Storage resizes a public photo on request when the path says
// render/image instead of object. Only our own public rental photos are
// rewritten; any other address is returned untouched.
//
// Cost: Supabase bills by distinct photo resized in a billing month: 100 are
// included on Pro, then US$5 per 1,000. Keep the widths below few and fixed.

const OBJECT_MARK = "/storage/v1/object/public/property-photos/";
const RENDER_MARK = "/storage/v1/render/image/public/property-photos/";

export const PHOTO_WIDTH_COVER = 1280;
export const PHOTO_WIDTH_THUMB = 480;
export const PHOTO_WIDTH_FULL = 1920;

/** A resized copy of one of our public rental photos, or the address as given. */
export function sizedPhotoUrl(url: string, width: number): string {
  if (typeof url !== "string" || !Number.isFinite(width) || width <= 0) return url;
  const at = url.indexOf(OBJECT_MARK);
  if (at < 0 || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url.slice(0, at))) return url;
  if (url.includes("?") || url.includes("#")) return url;
  const path = url.slice(at + OBJECT_MARK.length);
  if (!/\.(jpe?g|png|webp)$/i.test(path)) return url;
  const w = Math.min(2500, Math.round(width));
  const quality = w <= 600 ? 70 : 75;
  return `${url.slice(0, at)}${RENDER_MARK}${path}?width=${w}&quality=${quality}&resize=contain`;
}
