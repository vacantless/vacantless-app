import { fbGraphVersion } from "@/lib/facebook-page-oauth";
import {
  buildPageFeedMessage,
  classifyFacebookGraphError,
  type FacebookPageFeedListing,
} from "@/lib/facebook-page-graph";

// Instagram content publishing reuses the Facebook Graph surface (same host,
// same access token — the linked Page's token — same error shape). The one
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

export async function postToInstagram(args: {
  igUserId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}): Promise<InstagramPostResult> {
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

  // 1. Create the media container.
  const createBody = new URLSearchParams({
    image_url: imageUrl,
    caption: args.caption,
    access_token: accessToken,
  });
  let createRes: Response;
  try {
    createRes = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(igUserId)}/media`,
      { method: "POST", body: createBody, cache: "no-store" },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Instagram Graph request failed",
      isAuthError: false,
    };
  }
  let createPayload: unknown = null;
  try {
    createPayload = await createRes.json();
  } catch {
    createPayload = null;
  }
  if (!createRes.ok) return { ok: false, ...classifyFacebookGraphError(createPayload) };
  const creationId =
    createPayload && typeof createPayload === "object"
      ? (createPayload as { id?: unknown }).id
      : null;
  if (typeof creationId !== "string" || !creationId.trim()) {
    return {
      ok: false,
      error: "Instagram did not return a media container id.",
      isAuthError: false,
    };
  }

  // 2. Bounded readiness check.
  const ready = await waitForContainerReady(version, creationId.trim(), accessToken);
  if (!ready.ok) return ready;

  // 3. Publish the container.
  const publishBody = new URLSearchParams({
    creation_id: creationId.trim(),
    access_token: accessToken,
  });
  let publishRes: Response;
  try {
    publishRes = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(igUserId)}/media_publish`,
      { method: "POST", body: publishBody, cache: "no-store" },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Instagram Graph request failed",
      isAuthError: false,
    };
  }
  let publishPayload: unknown = null;
  try {
    publishPayload = await publishRes.json();
  } catch {
    publishPayload = null;
  }
  if (!publishRes.ok) return { ok: false, ...classifyFacebookGraphError(publishPayload) };
  const mediaId =
    publishPayload && typeof publishPayload === "object"
      ? (publishPayload as { id?: unknown }).id
      : null;
  if (typeof mediaId !== "string" || !mediaId.trim()) {
    return {
      ok: false,
      error: "Instagram did not return a media id.",
      isAuthError: false,
    };
  }

  // 4. Read the permalink (proof). Never mark live without it.
  const permalink = await fetchInstagramPermalink(mediaId.trim(), accessToken);
  if (!permalink) {
    return {
      ok: false,
      error: "Instagram did not return a permalink.",
      isAuthError: false,
    };
  }

  return { ok: true, mediaId: mediaId.trim(), permalink };
}
