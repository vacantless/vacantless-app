import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import {
  FB_PAGES_COOKIE,
  FB_STATE_COOKIE,
  type FacebookPageCandidate,
  type InstagramBusinessAccount,
  appBaseUrl,
  facebookReturnPath,
  fbAppId,
  fbGraphVersion,
  fbPageChannelEnabled,
  facebookPageScopes,
  finalizeFacebookPageConnection,
  igChannelEnabled,
  normalizeInstagramBusinessAccount,
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

type BusinessListResponse = {
  data?: { id?: string; name?: string }[];
};

type PageIdNameResponse = {
  data?: { id?: string; name?: string }[];
};

type PageNodeResponse = {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: InstagramBusinessAccount | null;
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

// Business-managed Pages do NOT appear in /me/accounts (KI921). Fall back to
// the user's Business Portfolios: list their businesses, enumerate the Pages
// each business owns or manages for a client, then mint a Page access token
// per Page id. Any Graph error is treated as "no business Pages" so the
// callback falls through to the same `nopages` result as before.
async function collectBusinessPageCandidates(
  userToken: string,
): Promise<FacebookPageCandidate[]> {
  const businesses = await graphGet<BusinessListResponse>("/me/businesses", {
    fields: "id,name",
    limit: "100",
    access_token: userToken,
  });
  if (graphTokenError(businesses) || !businesses.data?.length) return [];

  // Unique page id -> a best-effort display name from the edge.
  const pageIds = new Map<string, string>();
  for (const biz of businesses.data) {
    if (!biz.id) continue;
    for (const edge of ["owned_pages", "client_pages"] as const) {
      const resp = await graphGet<PageIdNameResponse>(`/${biz.id}/${edge}`, {
        fields: "id,name",
        limit: "100",
        access_token: userToken,
      });
      if (graphTokenError(resp)) continue;
      for (const p of resp.data ?? []) {
        if (p.id && !pageIds.has(p.id)) pageIds.set(p.id, p.name ?? p.id);
      }
    }
  }
  if (pageIds.size === 0) return [];

  // The edges above do not reliably return a Page token for business-managed
  // Pages, so mint one explicitly per Page id with the long-lived user token.
  const candidates: FacebookPageCandidate[] = [];
  for (const [pageId, fallbackName] of pageIds) {
    const node = await graphGet<PageNodeResponse>(`/${pageId}`, {
      fields: "id,name,access_token",
      access_token: userToken,
    });
    if (graphTokenError(node)) continue;
    if (node.id && node.access_token) {
      candidates.push({
        id: node.id,
        name: node.name || fallbackName,
        access_token: node.access_token,
      });
    }
  }
  return candidates;
}

async function attachInstagramBusinessAccounts(
  pages: FacebookPageCandidate[],
): Promise<FacebookPageCandidate[]> {
  if (!igChannelEnabled()) return pages;
  const enriched: FacebookPageCandidate[] = [];
  for (const page of pages) {
    const node = await graphGet<PageNodeResponse>(`/${page.id}`, {
      fields: "instagram_business_account{id,username}",
      access_token: page.access_token,
    });
    enriched.push({
      ...page,
      instagram_business_account: graphTokenError(node)
        ? null
        : normalizeInstagramBusinessAccount(node.instagram_business_account),
    });
  }
  return enriched;
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

  let candidates = (pages.data ?? []).filter(
    (p) => p.id && p.name && p.access_token,
  );
  // Personally-owned Pages come back from /me/accounts. Business-managed
  // Pages do not (KI921) - fall back to the user's Business Portfolios.
  if (candidates.length === 0) {
    candidates = await collectBusinessPageCandidates(longToken.access_token);
  }
  if (candidates.length === 0) {
    return redirectBack(req, state.propertyId, "error", "nopages");
  }
  candidates = await attachInstagramBusinessAccounts(candidates);

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
        scopes: facebookPageScopes(),
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
