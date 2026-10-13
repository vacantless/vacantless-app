import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAgentMarketplaceContext } from "@/lib/marketplace-kit-server";
import { marketplacePhotosZipResponse } from "@/lib/marketplace-photos-server";

export const dynamic = "force-dynamic";

// S712: the Marketplace kit's photo zip for a showing agent (no login; the
// agent token is the handle, and the rental must be in the agent's org).
export async function GET(
  _req: Request,
  { params }: { params: { token: string; propertyId: string } },
) {
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Not found", { status: 404 });
  const ctx = await loadAgentMarketplaceContext(admin, params.token, params.propertyId);
  if (!ctx) return new NextResponse("Not found", { status: 404 });
  return marketplacePhotosZipResponse(ctx.photos, ctx.property.address);
}
