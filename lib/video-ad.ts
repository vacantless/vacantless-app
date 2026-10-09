// video-ad.ts (S702). A 15-second vertical video ad made from a rental's own
// photos, right in the landlord's browser. Facebook, Instagram and TikTok
// show video ads to more people than photo posts. The pure plan lives here so
// the timing and the words are tested; the drawing is in the card component.

export const VIDEO_W = 720;
export const VIDEO_H = 1280;
export const VIDEO_MS = 15_000;
export const VIDEO_FPS = 30;
export const VIDEO_MAX_PHOTOS = 5;
const FADE_MS = 500;

export type VideoAdInput = {
  photoUrls: string[];
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  address: string;
  hook: string | null;
};

export type VideoAdPlan = {
  photos: string[];
  slideMs: number;
  top: string;
  price: string | null;
  details: string | null;
  address: string;
  hook: string;
  cta: string;
};

function bedLabel(beds: number | null): string | null {
  if (beds == null) return null;
  if (beds === 0) return "Studio";
  return `${beds} bed`;
}

export function buildVideoAdPlan(input: VideoAdInput): VideoAdPlan | null {
  const photos = input.photoUrls.filter(Boolean).slice(0, VIDEO_MAX_PHOTOS);
  if (photos.length === 0) return null;
  const price =
    typeof input.rentCents === "number" && input.rentCents > 0
      ? `$${Math.round(input.rentCents / 100).toLocaleString("en-CA")}/month`
      : null;
  const parts = [bedLabel(input.beds), input.baths != null ? `${input.baths} bath` : null].filter(Boolean);
  const fallbackHook = parts.length > 0 ? `${parts.join(", ")} for rent` : "Now renting";
  return {
    photos,
    slideMs: Math.floor(VIDEO_MS / photos.length),
    top: "FOR RENT",
    price,
    details: parts.length > 0 ? parts.join(" · ") : null,
    address: input.address.trim().slice(0, 60),
    hook: cleanHook(input.hook) ?? fallbackHook,
    cta: "Book a viewing online. Link in the post.",
  };
}

/** Keep an AI hook short and plain: at most 6 words, no dashes, no emoji. */
export function cleanHook(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[—–]/g, ",")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "");
  if (!s || /NO_HOOK/i.test(s) || /https?:/i.test(s)) return null;
  const words = s.split(" ");
  if (words.length > 6) s = words.slice(0, 6).join(" ");
  return s.slice(0, 48);
}

/** Which photo shows at time t, how far into it, and the fade to the next. */
export function frameAt(plan: Pick<VideoAdPlan, "photos" | "slideMs">, tMs: number): {
  index: number;
  progress: number;
  fadeNext: number;
} {
  const n = plan.photos.length;
  const t = Math.max(0, Math.min(VIDEO_MS - 1, tMs));
  const index = Math.min(n - 1, Math.floor(t / plan.slideMs));
  const into = t - index * plan.slideMs;
  const progress = into / plan.slideMs;
  const left = plan.slideMs - into;
  const fadeNext = index < n - 1 && left < FADE_MS ? 1 - left / FADE_MS : 0;
  return { index, progress, fadeNext };
}

/** Slow zoom from 100% to 112% across a slide. */
export function zoomAt(progress: number): number {
  return 1 + 0.12 * Math.max(0, Math.min(1, progress));
}

/** Browsers record different formats. Prefer MP4, which every site accepts. */
export const VIDEO_TYPES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function pickVideoType(isSupported: (t: string) => boolean): string | null {
  for (const t of VIDEO_TYPES) if (isSupported(t)) return t;
  return null;
}

export function videoFilename(address: string, mime: string): string {
  const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "rental";
  return `${slug}-video-ad.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`;
}

export const HOOK_SYSTEM_PROMPT = [
  "You write a short hook for a rental video ad from the rental's facts only.",
  "At most 6 plain words. No price, no address, no emoji, no dashes.",
  "If the facts give nothing special, reply NO_HOOK.",
].join(" ");
