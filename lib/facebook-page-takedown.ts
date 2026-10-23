// S734: take down the Facebook Page posts Vacantless made for a rental that
// left the market (leased, off market, paused, archived). The Page post is the
// one ad the product itself published (Graph API, the org's own Page token),
// so it is the one ad the product can delete. Ads on the landlord's own site
// accounts (Kijiji, Marketplace, Rentals.ca, Zumper) stay on the "ads still
// up" list for the landlord to delete by hand.
//
// Before S734 the leased path queued a "takedown" run item that nothing ran,
// and the landlord was told we cannot delete ads on their accounts. Now the
// delete runs right away, in the same request that changed the status.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { readChannelSession } from "@/lib/distribution-session-crypto";
import {
  deleteFacebookPagePost,
  facebookPagePostIdFromPermalink,
} from "@/lib/facebook-page-graph";

export const FACEBOOK_PAGE_PORTAL = "facebook_feed";

export type FacebookPageTakedownResult = {
  /** listing_posts ids now marked removed because we deleted the post. */
  removed: string[];
  /** listing_posts ids we could not delete (left live, landlord does it). */
  failed: string[];
};

export function vacantlessTookDownNote(prior: string | null | undefined, now: Date): string {
  const line = `Taken down by Vacantless on ${now.toISOString().slice(0, 10)} (Facebook Page post deleted).`;
  return prior?.trim() ? `${prior.trim()}\n${line}` : line;
}

export async function takeDownFacebookPagePosts(args: {
  supabase: SupabaseClient;
  organizationId: string;
  propertyId: string;
}): Promise<FacebookPageTakedownResult> {
  const result: FacebookPageTakedownResult = { removed: [], failed: [] };
  const { data: rows } = await args.supabase
    .from("listing_posts")
    .select("id, url, notes")
    .eq("organization_id", args.organizationId)
    .eq("property_id", args.propertyId)
    .eq("portal", FACEBOOK_PAGE_PORTAL)
    .eq("status", "live");
  const posts = ((rows ?? []) as { id: string; url: string | null; notes: string | null }[]).filter(
    (p) => !!facebookPagePostIdFromPermalink(p.url),
  );
  if (posts.length === 0) return result;

  const admin = createAdminClient();
  if (!admin) {
    result.failed.push(...posts.map((p) => p.id));
    return result;
  }
  let token = "";
  try {
    const session = await readChannelSession<{ page_access_token?: unknown }>({
      organizationId: args.organizationId,
      channel: FACEBOOK_PAGE_PORTAL,
      admin,
    });
    token = typeof session?.page_access_token === "string" ? session.page_access_token.trim() : "";
  } catch {
    token = "";
  }
  if (!token) {
    result.failed.push(...posts.map((p) => p.id));
    return result;
  }

  const now = new Date();
  for (const post of posts) {
    const objectId = facebookPagePostIdFromPermalink(post.url) as string;
    const outcome = await deleteFacebookPagePost({ postObjectId: objectId, pageAccessToken: token });
    if (!outcome.ok) {
      console.error("[facebook-page-takedown] delete failed", {
        propertyId: args.propertyId,
        listingPostId: post.id,
        error: outcome.error,
        code: outcome.code,
      });
      result.failed.push(post.id);
      continue;
    }
    await args.supabase
      .from("listing_posts")
      .update({ status: "removed", notes: vacantlessTookDownNote(post.notes, now) })
      .eq("id", post.id)
      .eq("organization_id", args.organizationId);
    await closeTakedownItems(args.supabase, args.organizationId, post.id, "Vacantless deleted the Facebook Page post");
    await resetLiveRunItemsForPost(args.supabase, args.organizationId, post.id);
    result.removed.push(post.id);
  }
  return result;
}

/**
 * A run item that still says "live" for a post that is gone blocks the next
 * "Post everywhere" (the autofire skips live items and the post action
 * refuses to reserve one). Put it back to queued with no post behind it, so
 * the next post makes a fresh row. Found live on 2026-10-23: a rental set
 * Live again after a takedown never reached the Page.
 */
export async function resetLiveRunItemsForPost(
  supabase: SupabaseClient,
  organizationId: string,
  listingPostId: string,
): Promise<void> {
  const nowISO = new Date().toISOString();
  await supabase
    .from("distribution_run_items")
    .update({
      status: "pending",
      publish_status: "queued",
      listing_post_id: null,
      external_url: null,
      audit_message: "The post was taken down; ready to post again.",
      updated_at: nowISO,
    })
    .eq("organization_id", organizationId)
    .eq("listing_post_id", listingPostId)
    .neq("transport", "takedown")
    .eq("publish_status", "live");
}

/**
 * Close any queued takedown run items for a listing post that is now gone,
 * whether we deleted it or the landlord did ("I took it down"). Without this
 * the item sat queued forever (S734 finding).
 */
export async function closeTakedownItems(
  supabase: SupabaseClient,
  organizationId: string,
  listingPostId: string,
  why: string,
): Promise<void> {
  const nowISO = new Date().toISOString();
  await supabase
    .from("distribution_run_items")
    .update({
      status: "done",
      publish_status: "skipped",
      blockers: [],
      audit_message: `Takedown closed: ${why}`,
      updated_at: nowISO,
    })
    .eq("organization_id", organizationId)
    .eq("listing_post_id", listingPostId)
    .eq("transport", "takedown")
    .neq("status", "done");
}
