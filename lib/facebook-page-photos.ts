// S734 (review item 6): a Facebook Page post with the rental's photos. The
// link post (one preview image, three lines) looked automated and Facebook
// shows photo posts to more people. This uploads up to FB_ALBUM_MAX_PHOTOS
// photos unpublished, then publishes one feed post that carries them with the
// description and the booking link. Falls back to the link post when a photo
// upload fails (lib/facebook-page-graph postToFacebookPageFeed).
import { fbGraphVersion } from "@/lib/facebook-page-oauth";
import {
  classifyFacebookGraphError,
  facebookPagePermalink,
  type FacebookPagePostResult,
} from "@/lib/facebook-page-graph";

export const FB_ALBUM_MAX_PHOTOS = 5;
/** Facebook truncates long posts behind "See more"; keep the description short. */
export const FB_ALBUM_DESCRIPTION_MAX = 500;

export type FacebookAlbumListing = {
  address: string | null;
  beds: number | null;
  baths: number | null;
  rentCents: number | null;
  description: string | null;
  publicUrl: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function countLabel(value: number | null, singular: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

/** The first paragraph or so of the landlord's description, cut on a sentence. */
export function albumDescriptionExcerpt(description: string | null | undefined): string | null {
  const text = (description ?? "").replace(/\r/g, "").trim();
  if (!text) return null;
  const firstBlock = text.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  if (firstBlock.length <= FB_ALBUM_DESCRIPTION_MAX) return firstBlock;
  const cut = firstBlock.slice(0, FB_ALBUM_DESCRIPTION_MAX);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim();
}

export function buildPageAlbumMessage(listing: FacebookAlbumListing): string {
  const address = clean(listing.address);
  const headline = address ? `For rent: ${address}` : "Rental listing now available";
  const facts = [
    [countLabel(listing.beds, "bed"), countLabel(listing.baths, "bath")].filter(Boolean).join(", ") || null,
    typeof listing.rentCents === "number" && listing.rentCents > 0
      ? `$${Math.round(listing.rentCents / 100).toLocaleString("en-CA")}/mo`
      : null,
  ].filter((part): part is string => Boolean(part));
  const excerpt = albumDescriptionExcerpt(listing.description);
  return [
    headline,
    facts.length > 0 ? facts.join(" | ") : null,
    excerpt,
    "Book a viewing online at the link below. Pick a time that suits you.",
    listing.publicUrl,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
    .replace(/[—–]/g, "-");
}

export type FacebookPhotoUploadResult =
  | { ok: true; mediaId: string }
  | { ok: false; error: string; isAuthError: boolean };

/** Upload one photo by public URL, unpublished, so a feed post can attach it. */
export async function uploadFacebookPagePhoto(args: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
}): Promise<FacebookPhotoUploadResult> {
  const body = new URLSearchParams({
    url: args.imageUrl,
    published: "false",
    temporary: "true",
    access_token: args.pageAccessToken,
  });
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${fbGraphVersion()}/${encodeURIComponent(args.pageId)}/photos`,
      { method: "POST", body, cache: "no-store" },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Facebook Graph request failed", isAuthError: false };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const c = classifyFacebookGraphError(payload);
    return { ok: false, error: c.error, isAuthError: c.isAuthError };
  }
  const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, error: "Facebook Graph did not return a photo id.", isAuthError: false };
  }
  return { ok: true, mediaId: id.trim() };
}

/** One feed post carrying the uploaded photos. */
export async function postToFacebookPageAlbum(args: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  mediaIds: readonly string[];
}): Promise<FacebookPagePostResult> {
  const body = new URLSearchParams({
    message: args.message,
    access_token: args.pageAccessToken,
  });
  args.mediaIds.forEach((id, i) => {
    body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
  });
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${fbGraphVersion()}/${encodeURIComponent(args.pageId)}/feed`,
      { method: "POST", body, cache: "no-store" },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Facebook Graph request failed", isAuthError: false };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) return { ok: false, ...classifyFacebookGraphError(payload) };
  const postId = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
  if (typeof postId !== "string" || !postId.trim()) {
    return { ok: false, error: "Facebook Graph did not return a post id.", isAuthError: false };
  }
  return { ok: true, postId: postId.trim(), permalink: facebookPagePermalink(args.pageId, postId) };
}

/**
 * Upload the photos, then post the album; when no photo uploads, return null
 * so the caller falls back to the link post.
 */
export async function postListingAlbumToFacebookPage(args: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  photoUrls: readonly string[];
}): Promise<FacebookPagePostResult | null> {
  const urls = args.photoUrls.filter((u) => typeof u === "string" && u.trim()).slice(0, FB_ALBUM_MAX_PHOTOS);
  if (urls.length === 0) return null;
  const mediaIds: string[] = [];
  for (const imageUrl of urls) {
    const up = await uploadFacebookPagePhoto({ pageId: args.pageId, pageAccessToken: args.pageAccessToken, imageUrl });
    if (up.ok) mediaIds.push(up.mediaId);
    else if (up.isAuthError) return { ok: false, error: up.error, isAuthError: true };
  }
  if (mediaIds.length === 0) return null;
  return postToFacebookPageAlbum({ pageId: args.pageId, pageAccessToken: args.pageAccessToken, message: args.message, mediaIds });
}
