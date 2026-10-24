import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPhoneMarketplaceContext } from "@/lib/marketplace-kit-server";
import { marketplacePhotosZipResponse } from "@/lib/marketplace-photos-server";

export const dynamic = "force-dynamic";

// S736: the photo zip for the phone kit page (the fallback when the phone's
// share sheet cannot take the photos). The signed token is the handle.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Not found", { status: 404 });
  const loaded = await loadPhoneMarketplaceContext(admin, params.token, Date.now());
  if (!loaded.ok) return new NextResponse("Not found", { status: 404 });
  return marketplacePhotosZipResponse(loaded.ctx.photos, loaded.ctx.property.address);
}
