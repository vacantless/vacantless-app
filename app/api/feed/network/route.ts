import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildNetworkFeedXml,
  type NetworkFeedProvider,
} from "@/lib/listing-feed";

// CROSS-ORG aggregate syndication feed (the platform-aggregator lever). One feed
// covering EVERY customer's active listings, so Vacantless can clear the volume
// gate (Zumper 50+, Rentsync multifamily) that no single small landlord can.
//
//   GET /api/feed/network?token=<NETWORK_FEED_TOKEN>
//
// DARK BY DEFAULT + PRIVATE. This exposes every customer's inventory, so:
//   - it is TOKEN-GATED: no NETWORK_FEED_TOKEN env, or a wrong/absent ?token,
//     returns 404 (indistinguishable from "no such route"). Until we hand a
//     partner the URL + token, the feature does not exist to the outside world.
//   - it reads via the SERVICE-ROLE admin client and the get_network_listing_feed
//     RPC is granted to service_role only (never anon), so the public anon key
//     can't dump the network feed even if someone guesses the path.
//
// Compare app/api/feed/[org] (per-org, anon-callable, one public org).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

function notFound() {
  return new Response("Not found", { status: 404 });
}

// Constant-time-ish token compare (avoids trivially leaking length via early
// exit). Both sides are short config strings; this is belt-and-suspenders.
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(req: NextRequest) {
  const expected = process.env.NETWORK_FEED_TOKEN;
  // Feature is OFF unless a token is configured. Never serve without a gate.
  if (!expected || !expected.trim()) return notFound();

  const provided = new URL(req.url).searchParams.get("token") ?? "";
  if (!provided || !tokenMatches(provided, expected)) return notFound();

  const admin = createAdminClient();
  if (!admin) {
    // Misconfiguration (no service-role key). Don't reveal the route exists.
    return notFound();
  }

  const { data, error } = await admin.rpc("get_network_listing_feed");
  // The RPC always returns a jsonb array (coalesced to '[]'). An error OR any
  // non-array success shape is unexpected: fail with 503 rather than serving a
  // misleadingly-empty 200 (preserves the "never partial data" guarantee). An
  // empty array is legitimate "zero providers" and still serves a valid 200.
  if (error || !Array.isArray(data)) {
    return new Response("Feed temporarily unavailable", { status: 503 });
  }

  const providers = data as NetworkFeedProvider[];
  const xml = buildNetworkFeedXml({
    providers,
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Private per-partner feed: don't let a CDN cache a token-authed response.
      "Cache-Control": "private, no-store",
    },
  });
}
