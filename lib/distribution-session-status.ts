// ============================================================================
// Post Everywhere Slice 1 (SPEC-S688 section 3.3 / 3.5): server-only writes
// for the connect tiles' session check.
//
//   requestSessionCheck()   marks account_login sessions as "please probe"
//                           (check_requested_at = now()); the worker's
//                           session-check job does the actual probe on the host
//                           that owns that channel's submit script.
//   probeOauthSessions()    Facebook Page / Instagram carry a Graph token, not
//                           a browser session, so the app checks those inline
//                           with GET /me and writes the same status columns.
//
// SERVER ONLY. Imports the service-role client and the session decryptor;
// scripts/test-no-client-secret-imports.ts asserts no client module pulls it
// in. Never logs a token.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { readChannelSession } from "./distribution-session-crypto";
import {
  CANONICAL_CHANNEL_REGISTRY,
  channelByKey,
  type DistributionChannel,
} from "./distribution-channels";
import { fbGraphVersion } from "./facebook-page-oauth";

const SESSIONS_TABLE = "distribution_channel_sessions";
const ACCOUNTS_TABLE = "distribution_channel_accounts";
const GRAPH_TIMEOUT_MS = 5_000;
// The registry has 14 channels; anything longer is not a tile talking.
const MAX_CHANNELS_PER_REQUEST = 32;

export type SessionCheckRequestResult = {
  requested: string[];
  missing: string[];
  probed: string[];
};

export type OauthProbeOutcome = {
  channel: string;
  code: "ok" | "needs_login" | "error" | "no_session";
  alive: boolean | null;
  accountLabel: string | null;
};

// Channels the tile may ask about: live channels with a connect step.
export function sessionCheckableChannels(
  input: unknown,
): { valid: DistributionChannel[]; rejected: string[] } {
  const valid: DistributionChannel[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(input) ? input.slice(0, MAX_CHANNELS_PER_REQUEST) : [];
  for (const raw of list) {
    if (typeof raw !== "string") {
      rejected.push("(not a string)");
      continue;
    }
    const channel = channelByKey(raw);
    if (
      !channel ||
      channel.connectKind === "none" ||
      channel.integrationStatus !== "live" ||
      seen.has(channel.key)
    ) {
      if (!seen.has(raw) && rejected.length < MAX_CHANNELS_PER_REQUEST) {
        rejected.push(raw.slice(0, 40));
      }
      continue;
    }
    seen.add(channel.key);
    valid.push(channel);
  }
  return { valid, rejected };
}

export function splitByConnectKind(channels: readonly DistributionChannel[]) {
  return {
    accountLogin: channels.filter((c) => c.connectKind === "account_login"),
    oauth: channels.filter((c) => c.connectKind === "oauth"),
  };
}

// In-memory per-instance throttle: one request per org per channel per 60 s.
// The worker's due filter (check_requested_at > last_checked_at) is the real
// guard; this only stops a tab that re-mounts in a loop from hammering writes.
const RATE_LIMIT_MS = 60_000;
const lastRequestAt = new Map<string, number>();

export function sessionCheckThrottled(
  orgId: string,
  channel: string,
  now: number = Date.now(),
): boolean {
  const key = `${orgId}:${channel}`;
  const at = lastRequestAt.get(key);
  if (at != null && now - at < RATE_LIMIT_MS) return true;
  lastRequestAt.set(key, now);
  if (lastRequestAt.size > 5_000) {
    for (const [k, v] of lastRequestAt) {
      if (now - v >= RATE_LIMIT_MS) lastRequestAt.delete(k);
    }
  }
  return false;
}

export async function requestSessionCheck(args: {
  orgId: string;
  channels: readonly string[];
  userId: string | null;
  admin?: SupabaseClient | null;
  now?: Date;
}): Promise<{ requested: string[]; missing: string[] }> {
  const admin = args.admin ?? createAdminClient();
  if (!admin) throw new Error("Supabase service role client is not configured");
  if (args.channels.length === 0) return { requested: [], missing: [] };

  const nowISO = (args.now ?? new Date()).toISOString();
  const { data, error } = await admin
    .from(SESSIONS_TABLE)
    .update({
      check_requested_at: nowISO,
      check_requested_by: args.userId,
    })
    .eq("organization_id", args.orgId)
    .in("channel", [...args.channels])
    .select("channel");
  if (error) throw new Error(`requestSessionCheck failed: ${error.message}`);

  const requested = new Set(
    ((data ?? []) as { channel: string }[]).map((row) => row.channel),
  );
  return {
    requested: args.channels.filter((c) => requested.has(c)),
    missing: args.channels.filter((c) => !requested.has(c)),
  };
}

type GraphMeResponse = {
  id?: string;
  name?: string;
  error?: { message?: string; code?: number; type?: string };
};

async function graphMe(
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: GraphMeResponse | null }> {
  const url = new URL(`https://graph.facebook.com/${fbGraphVersion()}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
    let body: GraphMeResponse | null = null;
    try {
      body = (await res.json()) as GraphMeResponse;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// Pure classification of a Graph /me answer (unit tested). 190 is Meta's
// OAuthException code for an expired, revoked, or invalid token.
export function classifyGraphMe(result: {
  status: number;
  body: GraphMeResponse | null;
}): { code: "ok" | "needs_login" | "error"; label: string | null; message: string | null } {
  const errCode = result.body?.error?.code;
  if (result.status === 200 && result.body?.id) {
    return { code: "ok", label: result.body.name ?? null, message: null };
  }
  if (errCode === 190 || result.status === 401) {
    return {
      code: "needs_login",
      label: null,
      message: result.body?.error?.message ?? "OAuth token rejected",
    };
  }
  return {
    code: "error",
    label: null,
    message:
      result.body?.error?.message ?? `Graph API answered ${result.status}`,
  };
}

export async function probeOauthSessions(args: {
  orgId: string;
  channels: readonly string[];
  admin?: SupabaseClient | null;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<OauthProbeOutcome[]> {
  const admin = args.admin ?? createAdminClient();
  if (!admin) throw new Error("Supabase service role client is not configured");
  const fetchImpl = args.fetchImpl ?? fetch;
  const nowISO = (args.now ?? new Date()).toISOString();
  const outcomes: OauthProbeOutcome[] = [];

  for (const channel of args.channels) {
    let blob: { page_access_token?: unknown; page_name?: unknown; ig_username?: unknown } | null =
      null;
    try {
      blob = await readChannelSession<{
        page_access_token?: unknown;
        page_name?: unknown;
        ig_username?: unknown;
      }>({ organizationId: args.orgId, channel, admin });
    } catch {
      blob = null;
    }
    const token = typeof blob?.page_access_token === "string" ? blob.page_access_token : null;

    if (!token) {
      // No row, expired row, or undecryptable: the tile reads Reconnect.
      const { error } = await admin
        .from(SESSIONS_TABLE)
        .update({
          alive: false,
          last_checked_at: nowISO,
          last_check_code: "no_session",
          last_check_error: null,
        })
        .eq("organization_id", args.orgId)
        .eq("channel", channel);
      void error;
      outcomes.push({ channel, code: "no_session", alive: false, accountLabel: null });
      continue;
    }

    let verdict: ReturnType<typeof classifyGraphMe>;
    try {
      verdict = classifyGraphMe(await graphMe(token, fetchImpl));
    } catch (err) {
      verdict = {
        code: "error",
        label: null,
        message: err instanceof Error ? err.message : "Graph API request failed",
      };
    }

    // Instagram's row carries the Page token too; its display name is the IG
    // handle, which the connect flow already stored, so keep that label.
    const label =
      channel === "instagram" && typeof blob?.ig_username === "string"
        ? `@${blob.ig_username}`
        : verdict.label ?? (typeof blob?.page_name === "string" ? blob.page_name : null);

    if (verdict.code === "ok") {
      await admin
        .from(SESSIONS_TABLE)
        .update({
          alive: true,
          account_label: label,
          last_checked_at: nowISO,
          last_check_code: "ok",
          last_check_error: null,
        })
        .eq("organization_id", args.orgId)
        .eq("channel", channel);
      outcomes.push({ channel, code: "ok", alive: true, accountLabel: label });
      continue;
    }

    if (verdict.code === "needs_login") {
      await admin
        .from(SESSIONS_TABLE)
        .update({
          alive: false,
          last_checked_at: nowISO,
          last_check_code: "needs_login",
          last_check_error: verdict.message,
        })
        .eq("organization_id", args.orgId)
        .eq("channel", channel);
      // Same precedent as the worker's takedown-leaseup markAccountNeedsLogin.
      await admin
        .from(ACCOUNTS_TABLE)
        .update({ account_status: "needs_login", updated_at: nowISO })
        .eq("organization_id", args.orgId)
        .eq("channel", channel)
        .eq("account_status", "connected");
      outcomes.push({ channel, code: "needs_login", alive: false, accountLabel: label });
      continue;
    }

    // Network or unexpected answer: record it, leave `alive` as it was.
    await admin
      .from(SESSIONS_TABLE)
      .update({
        last_checked_at: nowISO,
        last_check_code: "error",
        last_check_error: verdict.message,
      })
      .eq("organization_id", args.orgId)
      .eq("channel", channel);
    outcomes.push({ channel, code: "error", alive: null, accountLabel: label });
  }

  return outcomes;
}

export const SESSION_CHECKABLE_CHANNEL_KEYS = CANONICAL_CHANNEL_REGISTRY.filter(
  (c) => c.connectKind !== "none" && c.integrationStatus === "live",
).map((c) => c.key);
