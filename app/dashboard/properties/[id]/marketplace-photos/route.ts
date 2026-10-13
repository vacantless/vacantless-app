import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { marketplacePhotosZipResponse } from "@/lib/marketplace-photos-server";

export const dynamic = "force-dynamic";

// S712 Marketplace kit: the rental's photos in one zip, cover first, for the
// landlord to drag into Facebook Marketplace. Org-scoped: the property must
// belong to the signed-in org (RLS plus an explicit org filter).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));
  const supabase = createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, address")
    .eq("id", params.id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!prop) return new NextResponse("Not found", { status: 404 });
  const { data: photos } = await supabase
    .from("property_photos")
    .select("id, url, sort_order, is_cover")
    .eq("property_id", params.id)
    .eq("organization_id", org.id);
  return marketplacePhotosZipResponse(
    (photos ?? []) as { id: string; url: string; sort_order: number; is_cover: boolean }[],
    (prop as { address: string | null }).address,
  );
}
