import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildListingFeedXml,
  type FeedOrgInput,
  type FeedListingInput,
} from "@/lib/listing-feed";

// Public per-org rental syndication feed (the leasing-wedge front-of-funnel).
// An unauthenticated aggregator crawler (Rentsync / Zumper / PadMapper) fetches
//   GET /api/feed/<org-slug>           (or /api/feed/<org-slug>.xml)
// and gets a well-formed XML document of the org's ACTIVE listings. Data comes
// from the SECURITY DEFINER get_org_listing_feed RPC (anon-callable; no table
// grant to anon), so this route uses the ordinary anon server client. Only
// status='available' listings appear, and only those carrying every required
// field (price, photo, description, address) — the rest are dropped by the pure
// builder so the feed never ships an incomplete listing an aggregator rejects.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

type FeedPayload = {
  org: FeedOrgInput;
  listings: FeedListingInput[];
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { org: string } },
) {
  // Accept "agile" or "agile.xml".
  const slug = decodeURIComponent(params.org || "")
    .replace(/\.xml$/i, "")
    .trim();
  if (!slug) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_org_listing_feed", {
    p_org_slug: slug,
  });

  if (error || data == null) {
    // Unknown slug (RPC returns NULL) or a transient read error.
    return new Response("Not found", { status: 404 });
  }

  const payload = data as FeedPayload;
  const xml = buildListingFeedXml({
    org: payload.org,
    listings: Array.isArray(payload.listings) ? payload.listings : [],
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Aggregators poll periodically; a short CDN cache absorbs bursts. Held to
      // 60s (was 300, S447 Codex P2) so a delist / re-lease clears from the feed
      // within ~a minute instead of up to five; stale-while-revalidate lets the
      // CDN serve the last copy while it refetches so bursts still miss origin.
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60",
    },
  });
}
