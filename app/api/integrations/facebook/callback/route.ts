import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import {
  FB_PAGES_COOKIE,
  FB_STATE_COOKIE,
  FACEBOOK_PAGE_SCOPES,
  type FacebookPageCandidate,
  appBaseUrl,
  facebookReturnPath,
  fbAppId,
  fbGraphVersion,
  fbPageChannelEnabled,
  finalizeFacebookPageConnection,
  signCookiePayload,
  verifyOAuthState,
} from "@/lib/facebook-page-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORBIDDEN = "/dashboard/properties?forbidden=1";

type GraphErrorPayload = {
  message?: string;
  type?: string;
  code?: number;
};

type GraphJson<T> = T & {
  error?: GraphErrorPayload;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type PagesResponse = {
  data?: FacebookPageCandidate[];
};

function clearCookie(res: NextResponse, name: string): void {
  res.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

function redirectBack(
  req: NextRequest,
  propertyId: string | null,
  status: "connected" | "cancelled" | "error",
  reason?: string,
): NextResponse {
  const res = NextResponse.redirect(
    new URL(facebookReturnPath(propertyId, status, reason), req.url),
  );
  clearCookie(res, FB_STATE_COOKIE);
  return res;
}

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<GraphJson<T>> {
  const url = new URL(`https://graph.facebook.com/${fbGraphVersion()}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json()) as GraphJson<T>;
}

function graphTokenError(json: GraphJson<unknown>): string | null {
  if (!json.error) return null;
  return json.error.code != null ? `graph_${json.error.code}` : "graph_error";
}

export async function GET(req: NextRequest) {
  if (!fbPageChannelEnabled()) return new NextResponse("Not found", { status: 404 });

  const state = verifyOAuthState({
    stateParam: req.nextUrl.searchParams.get("state"),
    cookieValue: req.cookies.get(FB_STATE_COOKIE)?.value,
  });
  if (!state) return redirectBack(req, null, "error", "state");

  await requireCapability("manage_properties", FORBIDDEN);

  if (req.nextUrl.searchParams.get("error")) {
    return redirectBack(req, state.propertyId, "cancelled");
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return redirectBack(req, state.propertyId, "error", "code");

  const redirectUri = `${appBaseUrl()}/api/integrations/facebook/callback`;
  const shortToken = await graphGet<TokenResponse>("/oauth/access_token", {
    client_id: fbAppId(),
    client_secret: process.env.FB_APP_SECRET ?? "",
    redirect_uri: redirectUri,
    code,
  });
  const shortErr = graphTokenError(shortToken);
  if (shortErr || !shortToken.access_token) {
    return redirectBack(req, state.propertyId, "error", shortErr ?? "token");
  }

  const longToken = await graphGet<TokenResponse>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: fbAppId(),
    client_secret: process.env.FB_APP_SECRET ?? "",
    fb_exchange_token: shortToken.access_token,
  });
  const longErr = graphTokenError(longToken);
  if (longErr || !longToken.access_token) {
    return redirectBack(req, state.propertyId, "error", longErr ?? "token");
  }

  const pages = await graphGet<PagesResponse>("/me/accounts", {
    fields: "id,name,access_token",
    access_token: longToken.access_token,
  });
  const pagesErr = graphTokenError(pages);
  if (pagesErr) return redirectBack(req, state.propertyId, "error", pagesErr);

  const candidates = (pages.data ?? []).filter(
    (p) => p.id && p.name && p.access_token,
  );
  if (candidates.length === 0) {
    return redirectBack(req, state.propertyId, "error", "nopages");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const connectedBy = user?.id ?? null;

  if (candidates.length === 1) {
    try {
      await finalizeFacebookPageConnection({
        organizationId: state.orgId,
        propertyId: state.propertyId,
        page: candidates[0],
        connectedBy,
        scopes: FACEBOOK_PAGE_SCOPES,
      });
    } catch {
      return redirectBack(req, state.propertyId, "error", "store");
    }
    return redirectBack(req, state.propertyId, "connected");
  }

  const pickerPayload = {
    orgId: state.orgId,
    propertyId: state.propertyId,
    connectedBy,
    userAccessToken: longToken.access_token,
    pages: candidates.slice(0, 25),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const res = NextResponse.redirect(new URL("/dashboard/facebook-connect", req.url));
  clearCookie(res, FB_STATE_COOKIE);
  res.cookies.set(FB_PAGES_COOKIE, signCookiePayload(pickerPayload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
