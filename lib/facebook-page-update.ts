// ============================================================================
// facebook-page-update (S762, REVIEW-S761 item 2: edits follow, Page post).
//
// The Facebook Page post is the one ad Vacantless publishes itself (Graph API,
// the org's own Page token), so it is the one ad an edit can change in place:
// POST /{post-id} with a new message. Its photos cannot be swapped on Facebook
// (an album post keeps its photos), so a photo change leaves the Page post as
// it is; the text (rent, beds, baths, description) follows every edit.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { readChannelSession } from "@/lib/distribution-session-crypto";
import { classifyFacebookGraphError, facebookPagePostIdFromPermalink } from "@/lib/facebook-page-graph";
import { fbGraphVersion } from "@/lib/facebook-page-oauth";
import { buildPageAlbumMessage } from "@/lib/facebook-page-photos";
import { buildTrackedLink } from "@/lib/listing-distribution";

const FACEBOOK_PAGE_PORTAL = "facebook_feed";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

/** Fields the Page post's text shows. A photo change alone does not count. */
export const PAGE_POST_FIELDS = ["rent", "description", "bedrooms", "bathrooms"] as const;

/** Does this change reach the Page post's text? Pure. */
export function pagePostTextChanged(changedLabels: readonly string[]): boolean {
  return changedLabels.some((l) => (PAGE_POST_FIELDS as readonly string[]).includes(l));
}

export type FacebookPageEditResult =
  | { ok: true }
  | { ok: false; error: string; code?: number; isAuthError: boolean };

/** Change the text of a post we made on the landlord's Page. Facebook answers {"success":true}. */
export async function editFacebookPagePostMessage(args: {
  postObjectId: string;
  pageAccessToken: string;
  message: string;
}): Promise<FacebookPageEditResult> {
  const objectId = args.postObjectId.trim();
  const accessToken = args.pageAccessToken.trim();
  if (!objectId || !accessToken) {
    return { ok: false, error: "Facebook Page connection is missing a Page token.", isAuthError: true };
  }
  let response: Response;
  try {
    const body = new URLSearchParams({ message: args.message });
    response = await fetch(`https://graph.facebook.com/${fbGraphVersion()}/${encodeURIComponent(objectId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
      cache: "no-store",
    });
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
  return { ok: true };
}

/**
 * Update the text of every live Page post for this rental after an edit.
 * Never throws. Returns how many posts changed and how many could not.
 */
export async function updateFacebookPagePosts(args: {
  supabase: SupabaseClient;
  organizationId: string;
  propertyId: string;
}): Promise<{ updated: number; failed: number }> {
  const result = { updated: 0, failed: 0 };
  try {
    const { data: rows } = await args.supabase
      .from("listing_posts")
      .select("id, url")
      .eq("organization_id", args.organizationId)
      .eq("property_id", args.propertyId)
      .eq("portal", FACEBOOK_PAGE_PORTAL)
      .eq("status", "live");
    const posts = ((rows ?? []) as { id: string; url: string | null }[]).filter(
      (p) => !!facebookPagePostIdFromPermalink(p.url),
    );
    if (posts.length === 0) return result;

    const { data: property } = await args.supabase
      .from("properties")
      .select("address, beds, baths, rent_cents, description")
      .eq("id", args.propertyId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();
    if (!property) return result;
    const p = property as {
      address: string | null;
      beds: number | null;
      baths: number | null;
      rent_cents: number | null;
      description: string | null;
    };

    const admin = createAdminClient();
    if (!admin) {
      result.failed = posts.length;
      return result;
    }
    const session = await readChannelSession<{ page_access_token?: unknown }>({
      organizationId: args.organizationId,
      channel: FACEBOOK_PAGE_PORTAL,
      admin,
    }).catch(() => null);
    const token = typeof session?.page_access_token === "string" ? session.page_access_token.trim() : "";
    if (!token) {
      result.failed = posts.length;
      return result;
    }

    const publicUrl = `${APP_URL.replace(/\/+$/, "")}/r/${args.propertyId}`;
    for (const post of posts) {
      const message = buildPageAlbumMessage({
        address: p.address,
        beds: p.beds,
        baths: p.baths,
        rentCents: p.rent_cents,
        description: p.description,
        publicUrl: buildTrackedLink(publicUrl, post.id),
      });
      const outcome = await editFacebookPagePostMessage({
        postObjectId: facebookPagePostIdFromPermalink(post.url) as string,
        pageAccessToken: token,
        message,
      });
      if (outcome.ok) result.updated++;
      else {
        result.failed++;
        console.error("[facebook-page-update] edit failed", {
          propertyId: args.propertyId,
          listingPostId: post.id,
          error: outcome.error,
          code: outcome.code,
        });
      }
    }
  } catch (err) {
    console.error("[facebook-page-update] failed", {
      propertyId: args.propertyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}
