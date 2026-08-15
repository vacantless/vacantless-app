import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  FB_STATE_COOKIE,
  appBaseUrl,
  createOAuthState,
  facebookOAuthConfigured,
  facebookReturnPath,
  fbAppId,
  fbGraphVersion,
  fbPageChannelEnabled,
  facebookPageScopes,
  igChannelEnabledForOrg,
} from "@/lib/facebook-page-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORBIDDEN = "/dashboard/properties?forbidden=1";

async function propertyOrgId(propertyId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("properties")
    .select("organization_id")
    .eq("id", propertyId)
    .maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

export async function GET(req: NextRequest) {
  if (!fbPageChannelEnabled()) return new NextResponse("Not found", { status: 404 });

  await requireCapability("manage_properties", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/onboarding", req.url));

  const requestedPropertyId = req.nextUrl.searchParams.get("propertyId")?.trim() || null;
  let propertyId: string | null = null;
  if (requestedPropertyId) {
    const orgId = await propertyOrgId(requestedPropertyId);
    if (orgId !== org.id) {
      return NextResponse.redirect(new URL(FORBIDDEN, req.url));
    }
    propertyId = requestedPropertyId;
  }

  if (!facebookOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(facebookReturnPath(propertyId, "error", "config"), req.url),
    );
  }

  const { token } = createOAuthState({ orgId: org.id, propertyId });
  const redirectUri = `${appBaseUrl()}/api/integrations/facebook/callback`;
  const fb = new URL(`https://www.facebook.com/${fbGraphVersion()}/dialog/oauth`);
  fb.searchParams.set("client_id", fbAppId());
  fb.searchParams.set("redirect_uri", redirectUri);
  fb.searchParams.set("state", token);
  fb.searchParams.set(
    "scope",
    facebookPageScopes({ instagramEnabled: igChannelEnabledForOrg(org.id) }).join(","),
  );
  fb.searchParams.set("response_type", "code");

  const res = NextResponse.redirect(fb);
  res.cookies.set(FB_STATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
