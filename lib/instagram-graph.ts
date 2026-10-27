import { fbGraphVersion } from "@/lib/facebook-page-oauth";
import {
  buildPageFeedMessage,
  classifyFacebookGraphError,
  type FacebookPageFeedListing,
} from "@/lib/facebook-page-graph";

// Instagram content publishing reuses the Facebook Graph surface (same host,
// same access token (the linked Page's token), same error shape). The one
// structural difference vs. the Page feed lane: publishing is a TWO-step
// container -> publish flow, it REQUIRES a public image_url, and the permalink
// must be read back from the API. Egress stays graph.facebook.com ONLY.

export type InstagramFeedListing = FacebookPageFeedListing;

export type InstagramPostResult =
  | { ok: true; mediaId: string; permalink: string }
  | { ok: false; error: string; code?: number; isAuthError: boolean };

// v1: the caption is the same facts the Page feed message renders. On Instagram
// the tracked link is NOT clickable, so it appears as plain text in the caption
// (the channel copy already tells operators this). Kept as its own function so a
// future slice can tune IG-specific caption/hashtag behaviour without touching
// the live Facebook Page lane.
export function buildInstagramCaption(listing: InstagramFeedListing): string {
  return buildPageFeedMessage(listing);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchInstagramPermalink(
  mediaId: string,
  accessToken: string,
): Promise<string | null> {
  const id = mediaId.trim();
  const token = accessToken.trim();
  if (!id || !token) return null;
  try {
    const url = new URL(
      `https://graph.facebook.com/${fbGraphVersion()}/${encodeURIComponent(id)}`,
    );
    url.searchParams.set("fields", "permalink");
    url.searchParams.set("access_token", token);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { permalink?: unknown };
    return typeof json.permalink === "string" && json.permalink.trim()
      ? json.permalink.trim()
      : null;
  } catch {
    return null;
  }
}

// Bounded readiness check on the media container. Images are usually ready
// immediately; this gives the container a few short beats and only HARD-fails on
// an explicit ERROR/EXPIRED. If it never reports FINISHED but also never errors,
// we let media_publish be the arbiter rather than false-negative.
async function waitForContainerReady(
  version: string,
  creationId: string,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string; isAuthError: boolean }> {
  for (let i = 0; i < 3; i++) {
    let res: Response | null = null;
    try {
      const url = new URL(
        `https://graph.facebook.com/${version}/${encodeURIComponent(creationId)}`,
      );
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", accessToken);
      res = await fetch(url, { cache: "no-store" });
    } catch {
      await delay(1500);
      continue;
    }
    let json: { status_code?: unknown } = {};
    try {
      json = (await res.json()) as { status_code?: unknown };
    } catch {
      json = {};
    }
    const status = typeof json.status_code === "string" ? json.status_code : "";
    if (status === "FINISHED") return { ok: true };
    if (status === "ERROR" || status === "EXPIRED") {
      return {
        ok: false,
        error: `Instagram could not process the image (${status}).`,
        isAuthError: false,
      };
    }
    await delay(1500);
  }
  return { ok: true };
}

// S739: up to this many photos per Instagram post, the same as the Page album
// (lib/facebook-page-photos FB_ALBUM_MAX_PHOTOS). Instagram allows more; five
// keeps a Set Live inside one server action.
export const IG_CAROUSEL_MAX_PHOTOS = 5;

/** The photos to post: public https links, no repeats, cover first, at most the max. Pure. */
export function instagramPhotoUrls(photos: unknown, max = IG_CAROUSEL_MAX_PHOTOS): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const p of photos) {
    const u = typeof p === "string" ? p.trim() : "";
    if (!/^https:\/\//i.test(u) || out.includes(u)) continue;
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

type GraphStep = { ok: true; id: string } | { ok: false; error: string; code?: number; isAuthError: boolean };

// Facebook stamps "OAuthException" on nearly every Graph error, bad photos
// included (9004 "Only photo or video can be accepted", 36003 aspect ratio), so
// isAuthError alone would stop a carousel over one photo. Only these codes mean
// the sign-in itself is gone: 190 token, 102 session, 10 and 200 permission.
const SIGN_IN_CODES = new Set([190, 102, 10, 200]);
function signInGone(step: GraphStep): step is Extract<GraphStep, { ok: false }> {
  return !step.ok && step.isAuthError && typeof step.code === "number" && SIGN_IN_CODES.has(step.code);
}

async function graphPost(version: string, path: string, body: URLSearchParams, what: string): Promise<GraphStep> {
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${version}/${path}`, { method: "POST", body, cache: "no-store" });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Instagram Graph request failed", isAuthError: false };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) return { ok: false, ...classifyFacebookGraphError(payload) };
  const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id.trim()) return { ok: false, error: `Instagram did not return ${what}.`, isAuthError: false };
  return { ok: true, id: id.trim() };
}

/** One container, then its readiness check. */
async function createContainer(
  version: string,
  igUserId: string,
  fields: Record<string, string>,
  accessToken: string,
): Promise<GraphStep> {
  const made = await graphPost(
    version,
    `${encodeURIComponent(igUserId)}/media`,
    new URLSearchParams({ ...fields, access_token: accessToken }),
    "a media container id",
  );
  if (!made.ok) return made;
  const ready = await waitForContainerReady(version, made.id, accessToken);
  if (!ready.ok) return ready;
  return made;
}

/**
 * Post a rental to Instagram. With two or more photos it is a carousel (S739):
 * one item container per photo, then a CAROUSEL container holding them, then
 * publish. If any photo is refused for a reason other than the sign-in, it
 * falls back to the single cover photo, so a rental never loses its post over
 * one bad photo. A sign-in error stops at once (the caller marks the account).
 */
export async function postToInstagram(args: {
  igUserId: string;
  pageAccessToken: string;
  /** The cover photo; used alone when imageUrls has fewer than two. */
  imageUrl: string;
  /** S739: cover first, up to IG_CAROUSEL_MAX_PHOTOS. */
  imageUrls?: string[];
  caption: string;
}): Promise<InstagramPostResult & { photoCount?: number }> {
  const igUserId = args.igUserId.trim();
  const accessToken = args.pageAccessToken.trim();
  const imageUrl = args.imageUrl.trim();
  if (!igUserId || !accessToken) {
    return {
      ok: false,
      error: "Instagram connection is missing an access token.",
      isAuthError: true,
    };
  }
  if (!imageUrl) {
    return {
      ok: false,
      error: "Instagram requires a public image for the post.",
      isAuthError: false,
    };
  }
  const version = fbGraphVersion();
  const photos = instagramPhotoUrls([imageUrl, ...(args.imageUrls ?? [])]);

  let creation: GraphStep | null = null;
  let photoCount = 1;
  if (photos.length >= 2) {
    // All photos at once (S739 live test: one by one took about 40 seconds
    // for five photos inside Set Live). Order is kept by index.
    const made = await Promise.all(
      photos.map((url) => createContainer(version, igUserId, { image_url: url, is_carousel_item: "true" }, accessToken)),
    );
    const children: string[] = [];
    let failed: GraphStep | null = null;
    for (const child of made) {
      if (!child.ok) {
        failed = failed && signInGone(failed) ? failed : child;
        continue;
      }
      children.push(child.id);
    }
    if (failed && signInGone(failed)) return failed;
    if (!failed) {
      const parent = await createContainer(
        version,
        igUserId,
        { media_type: "CAROUSEL", children: children.join(","), caption: args.caption },
        accessToken,
      );
      if (signInGone(parent)) return parent;
      if (parent.ok) {
        creation = parent;
        photoCount = children.length;
      }
    }
  }
  // One photo, or the carousel could not be built: the cover alone.
  if (!creation) {
    creation = await createContainer(version, igUserId, { image_url: imageUrl, caption: args.caption }, accessToken);
    photoCount = 1;
  }
  if (!creation.ok) return creation;

  // Publish the container.
  const published = await graphPost(
    version,
    `${encodeURIComponent(igUserId)}/media_publish`,
    new URLSearchParams({ creation_id: creation.id, access_token: accessToken }),
    "a media id",
  );
  if (!published.ok) return published;

  // Read the permalink (proof). Never mark live without it.
  const permalink = await fetchInstagramPermalink(published.id, accessToken);
  if (!permalink) {
    return {
      ok: false,
      error: "Instagram did not return a permalink.",
      isAuthError: false,
    };
  }

  return { ok: true, mediaId: published.id, permalink, photoCount };
}
