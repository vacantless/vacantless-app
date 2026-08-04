import { fbGraphVersion } from "@/lib/facebook-page-oauth";

export type FacebookPageFeedListing = {
  address: string | null;
  beds: number | null;
  baths: number | null;
  rentCents: number | null;
  publicUrl: string;
};

export type FacebookPagePostResult =
  | { ok: true; postId: string; permalink: string }
  | { ok: false; error: string; code?: number; isAuthError: boolean };

type GraphErrorShape = {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
};

function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim().replace(/\s+/g, " ");
  return text || null;
}

function countLabel(value: number | null, singular: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const rounded = Number.isInteger(value) ? String(value) : String(value);
  return `${rounded} ${value === 1 ? singular : `${singular}s`}`;
}

function moneyLabel(cents: number | null): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return null;
  }
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}/mo`;
}

function bedBathLabel(beds: number | null, baths: number | null): string | null {
  const parts = [
    countLabel(beds, "bed"),
    countLabel(baths, "bath"),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

export function buildPageFeedMessage(listing: FacebookPageFeedListing): string {
  const address = cleanText(listing.address);
  const headline = address
    ? `For rent: ${address}`
    : "Rental listing now available";
  const facts = [
    bedBathLabel(listing.beds, listing.baths),
    moneyLabel(listing.rentCents),
  ].filter((part): part is string => Boolean(part));
  return [
    headline,
    facts.length > 0 ? facts.join(" | ") : null,
    `View details and inquire: ${listing.publicUrl}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

export function facebookPagePermalink(pageId: string, postId: string): string {
  const cleanPageId = pageId.trim();
  const cleanPostId = postId.trim();
  const objectId = cleanPostId.includes("_")
    ? cleanPostId
    : `${cleanPageId}_${cleanPostId}`;
  return `https://www.facebook.com/${encodeURIComponent(objectId)}`;
}

export function classifyFacebookGraphError(payload: unknown): {
  error: string;
  code?: number;
  isAuthError: boolean;
} {
  const root =
    payload && typeof payload === "object"
      ? (payload as { error?: unknown }).error ?? payload
      : null;
  const err =
    root && typeof root === "object" ? (root as GraphErrorShape) : {};
  const message =
    typeof err.message === "string" && err.message.trim()
      ? err.message.trim()
      : "Facebook Graph request failed";
  const code = typeof err.code === "number" ? err.code : undefined;
  const subcode =
    typeof err.error_subcode === "number" ? err.error_subcode : undefined;
  const type = typeof err.type === "string" ? err.type : "";
  const isAuthError =
    type === "OAuthException" ||
    code === 190 ||
    subcode === 458 ||
    subcode === 459 ||
    subcode === 460 ||
    subcode === 463 ||
    subcode === 467;
  return { error: message, code, isAuthError };
}

export async function postToFacebookPageFeed(args: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  link?: string | null;
}): Promise<FacebookPagePostResult> {
  const pageId = args.pageId.trim();
  const accessToken = args.pageAccessToken.trim();
  if (!pageId || !accessToken) {
    return {
      ok: false,
      error: "Facebook Page connection is missing a Page token.",
      isAuthError: true,
    };
  }

  const body = new URLSearchParams({
    message: args.message,
    access_token: accessToken,
  });
  if (args.link?.trim()) body.set("link", args.link.trim());

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${fbGraphVersion()}/${encodeURIComponent(pageId)}/feed`,
      {
        method: "POST",
        body,
        cache: "no-store",
      },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Facebook Graph request failed",
      isAuthError: false,
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return { ok: false, ...classifyFacebookGraphError(payload) };
  }

  const postId =
    payload && typeof payload === "object"
      ? (payload as { id?: unknown }).id
      : null;
  if (typeof postId !== "string" || !postId.trim()) {
    return {
      ok: false,
      error: "Facebook Graph did not return a post id.",
      isAuthError: false,
    };
  }

  return {
    ok: true,
    postId: postId.trim(),
    permalink: facebookPagePermalink(pageId, postId),
  };
}
