import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteChannelSession,
  writeChannelSession,
} from "@/lib/distribution-session-crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const FACEBOOK_FEED_CHANNEL = "facebook_feed";
export const INSTAGRAM_CHANNEL = "instagram";
export const FB_STATE_COOKIE = "fb_oauth_state";
export const FB_PAGES_COOKIE = "fb_oauth_pages";
export const FACEBOOK_PAGE_BASE_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  // Needed to enumerate business-managed Pages via /me/businesses ->
  // owned_pages / client_pages (KI921: those Pages do NOT appear in
  // /me/accounts). Must be added to the Meta app use case ("Ready for
  // testing" in DEV mode) or OAuth rejects the whole login as Invalid Scopes.
  "business_management",
] as const;
export const INSTAGRAM_GRAPH_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
] as const;
export const FACEBOOK_PAGE_SCOPES = FACEBOOK_PAGE_BASE_SCOPES;

export type FacebookOAuthState = {
  orgId: string;
  propertyId: string | null;
  nonce: string;
  exp: number;
};

export type FacebookPageCandidate = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: InstagramBusinessAccount | null;
};

export type InstagramBusinessAccount = {
  id: string;
  username: string | null;
};

export type FacebookPagesCookie = {
  orgId: string;
  propertyId: string | null;
  connectedBy: string | null;
  userAccessToken: string;
  pages: FacebookPageCandidate[];
  exp: number;
};

export function fbPageChannelEnabled(): boolean {
  return process.env.FB_PAGE_CHANNEL_ENABLED === "true";
}

export function igChannelEnabled(): boolean {
  return process.env.IG_CHANNEL_ENABLED === "true";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function clean(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function normalizeOrgId(value: string | null | undefined): string | null {
  const orgId = clean(value)?.toLowerCase() ?? null;
  return orgId && UUID_RE.test(orgId) ? orgId : null;
}

export function parseIgChannelOrgAllowlist(
  value: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const raw of String(value ?? "").split(",")) {
    const orgId = normalizeOrgId(raw);
    if (orgId) ids.add(orgId);
  }
  return ids;
}

const IG_CHANNEL_ORG_ALLOWLIST = parseIgChannelOrgAllowlist(
  process.env.IG_CHANNEL_ORG_ALLOWLIST,
);

export function igChannelEnabledForOrg(
  organizationId: string | null | undefined,
  allowlist: ReadonlySet<string> = IG_CHANNEL_ORG_ALLOWLIST,
): boolean {
  if (!igChannelEnabled()) return false;
  if (allowlist.size === 0) return true;
  const orgId = normalizeOrgId(organizationId);
  return orgId ? allowlist.has(orgId) : false;
}

export function facebookPageScopes(opts?: {
  instagramEnabled?: boolean;
}): string[] {
  const instagramEnabled = opts?.instagramEnabled ?? igChannelEnabled();
  return instagramEnabled
    ? [...FACEBOOK_PAGE_BASE_SCOPES, ...INSTAGRAM_GRAPH_SCOPES]
    : [...FACEBOOK_PAGE_BASE_SCOPES];
}

export function fbGraphVersion(): string {
  return (process.env.FB_GRAPH_VERSION || "v21.0").trim() || "v21.0";
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(
    /\/+$/,
    "",
  );
}

export function facebookOAuthConfigured(): boolean {
  return Boolean(process.env.FB_APP_ID?.trim() && process.env.FB_APP_SECRET?.trim());
}

function fbAppSecret(): string {
  const secret = process.env.FB_APP_SECRET?.trim();
  if (!secret) throw new Error("FB_APP_SECRET is not set");
  return secret;
}

export function fbAppId(): string {
  const appId = process.env.FB_APP_ID?.trim();
  if (!appId) throw new Error("FB_APP_ID is not set");
  return appId;
}

function signBody(body: string, secret = fbAppSecret()): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function equalSig(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function signCookiePayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signBody(body)}`;
}

export function verifyCookiePayload<T extends { exp?: unknown }>(
  token: string | null | undefined,
): T | null {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra != null) return null;
  let expected: string;
  try {
    expected = signBody(body);
  } catch {
    return null;
  }
  if (!equalSig(expected, sig)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as T;
    if (typeof payload.exp === "number" && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createOAuthState(args: {
  orgId: string;
  propertyId?: string | null;
}): { payload: FacebookOAuthState; token: string } {
  const payload: FacebookOAuthState = {
    orgId: args.orgId,
    propertyId: args.propertyId ?? null,
    nonce: randomBytes(16).toString("base64url"),
    exp: Date.now() + 10 * 60 * 1000,
  };
  return { payload, token: signCookiePayload(payload) };
}

export function verifyOAuthState(args: {
  stateParam: string | null;
  cookieValue: string | null | undefined;
}): FacebookOAuthState | null {
  if (!args.stateParam || !args.cookieValue) return null;
  if (args.stateParam !== args.cookieValue) return null;
  return verifyCookiePayload<FacebookOAuthState>(args.stateParam);
}

export function verifyPagesCookie(
  token: string | null | undefined,
): FacebookPagesCookie | null {
  const payload = verifyCookiePayload<FacebookPagesCookie>(token);
  if (!payload) return null;
  if (!payload.orgId || !Array.isArray(payload.pages)) return null;
  return payload;
}

export function normalizeInstagramBusinessAccount(
  raw: unknown,
): InstagramBusinessAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!id) return null;
  const username =
    typeof obj.username === "string" && obj.username.trim()
      ? obj.username.trim().replace(/^@+/, "")
      : null;
  return { id, username };
}

export function instagramAccountLabel(
  account: InstagramBusinessAccount | null | undefined,
): string | null {
  if (!account) return null;
  return account.username ? `@${account.username}` : `Instagram user ${account.id}`;
}

export function facebookReturnPath(
  propertyId: string | null | undefined,
  status: "connected" | "disconnected" | "cancelled" | "error",
  reason?: string,
): string {
  const params = new URLSearchParams({ fb: status });
  if (reason) params.set("reason", reason);
  if (!propertyId) return `/dashboard/properties?${params.toString()}`;
  params.set("tab", "distribute");
  return `/dashboard/properties/${encodeURIComponent(propertyId)}?${params.toString()}#distribute-header`;
}

export async function finalizeFacebookPageConnection(args: {
  organizationId: string;
  propertyId: string | null;
  page: FacebookPageCandidate;
  connectedBy: string | null;
  scopes?: readonly string[];
  admin?: SupabaseClient | null;
}): Promise<void> {
  const admin = args.admin ?? createAdminClient();
  if (!admin) throw new Error("Supabase service role client is not configured");
  const nowISO = new Date().toISOString();
  const instagramEnabled = igChannelEnabledForOrg(args.organizationId);
  const scopes = args.scopes ?? facebookPageScopes({ instagramEnabled });
  const tokenBlob = {
    page_id: args.page.id,
    page_name: args.page.name,
    page_access_token: args.page.access_token,
    scopes,
    connected_at: nowISO,
    connected_by: args.connectedBy,
  };
  await writeChannelSession({
    organizationId: args.organizationId,
    channel: FACEBOOK_FEED_CHANNEL,
    storageStateJson: JSON.stringify(tokenBlob),
    warmedBy: args.connectedBy,
    admin,
  });
  const { error } = await admin.from("distribution_channel_accounts").upsert(
    {
      organization_id: args.organizationId,
      channel: FACEBOOK_FEED_CHANNEL,
      transport: "automatic",
      account_status: "connected",
      external_account_label: args.page.name,
      requires_login: false,
      requires_payment: false,
      supports_feed: false,
      supports_copilot: false,
      supports_concierge: true,
      supports_live_verification: true,
      posting_policy: "human_confirmed",
      capabilities: {
        graph_api_page: true,
        graph_version: fbGraphVersion(),
        page_id: args.page.id,
      },
      automation_authorized: false,
      automation_authorized_at: null,
      automation_authorized_by: null,
      last_setup_checked_at: nowISO,
      updated_at: nowISO,
    },
    { onConflict: "organization_id,channel" },
  );
  if (error) throw new Error(`facebook account upsert failed: ${error.message}`);

  if (!instagramEnabled) return;

  const igAccount = args.page.instagram_business_account ?? null;
  if (!igAccount) {
    await deleteChannelSession({
      organizationId: args.organizationId,
      channel: INSTAGRAM_CHANNEL,
      admin,
    });
    const { error: igMissingErr } = await admin
      .from("distribution_channel_accounts")
      .upsert(
        {
          organization_id: args.organizationId,
          channel: INSTAGRAM_CHANNEL,
          transport: "automatic",
          account_status: "needs_setup",
          external_account_label: null,
          requires_login: false,
          requires_payment: false,
          supports_feed: false,
          supports_copilot: false,
          supports_concierge: true,
          supports_live_verification: true,
          posting_policy: "human_confirmed",
          automation_authorized: false,
          automation_authorized_at: null,
          automation_authorized_by: null,
          capabilities: {
            graph_api_instagram: true,
            graph_version: fbGraphVersion(),
            page_id: args.page.id,
            page_name: args.page.name,
            linked_ig_business_account: false,
            setup_reason: "no_linked_instagram_business_account",
          },
          last_setup_checked_at: nowISO,
          updated_at: nowISO,
        },
        { onConflict: "organization_id,channel" },
      );
    if (igMissingErr) {
      throw new Error(`instagram account upsert failed: ${igMissingErr.message}`);
    }
    return;
  }

  const igLabel = instagramAccountLabel(igAccount);
  const igTokenBlob = {
    page_id: args.page.id,
    page_name: args.page.name,
    page_access_token: args.page.access_token,
    ig_user_id: igAccount.id,
    ig_username: igAccount.username,
    scopes,
    connected_at: nowISO,
    connected_by: args.connectedBy,
  };
  await writeChannelSession({
    organizationId: args.organizationId,
    channel: INSTAGRAM_CHANNEL,
    storageStateJson: JSON.stringify(igTokenBlob),
    warmedBy: args.connectedBy,
    admin,
  });
  const { error: igErr } = await admin.from("distribution_channel_accounts").upsert(
    {
      organization_id: args.organizationId,
      channel: INSTAGRAM_CHANNEL,
      transport: "automatic",
      account_status: "connected",
      external_account_label: igLabel,
      requires_login: false,
      requires_payment: false,
      supports_feed: false,
      supports_copilot: false,
      supports_concierge: true,
      supports_live_verification: true,
      posting_policy: "human_confirmed",
      capabilities: {
        graph_api_instagram: true,
        graph_version: fbGraphVersion(),
        page_id: args.page.id,
        page_name: args.page.name,
        ig_user_id: igAccount.id,
        ig_username: igAccount.username,
        shared_page_session: true,
      },
      last_setup_checked_at: nowISO,
      updated_at: nowISO,
    },
    { onConflict: "organization_id,channel" },
  );
  if (igErr) throw new Error(`instagram account upsert failed: ${igErr.message}`);
}
