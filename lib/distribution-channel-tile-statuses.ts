import {
  CANONICAL_CHANNEL_REGISTRY,
  channelByKey,
  channelTileStatus,
  type ChannelTileAccount,
  type ChannelTileSession,
  type ChannelTileState,
  type ChannelTileStatus,
} from "./distribution-channels";

export type DistributionChannelAccountTileRow = {
  channel: string | null;
  account_status: string | null;
  automation_authorized: boolean | null;
  external_account_label?: string | null;
  spend_authorized?: boolean | null;
  spend_max_cents?: number | null;
  spend_revoked_at?: string | null;
  capabilities?: Record<string, unknown> | null;
};

// One row of the 0225 `distribution_channel_session_status` view (no secret
// columns exist on it, by grant).
export type DistributionChannelSessionStatusRow = {
  channel: string | null;
  account_label: string | null;
  alive: boolean | null;
  cap_used: number | null;
  cap_total: number | null;
  last_checked_at: string | null;
  last_check_code: string | null;
  last_check_error: string | null;
  check_pending: boolean | null;
  stale: boolean | null;
  last_validated_at?: string | null;
};

export type ChannelTileStatusRow = {
  channel: string;
} & ChannelTileStatus;

export type ChannelTileAccountReader = (
  orgId: string,
) => Promise<readonly DistributionChannelAccountTileRow[] | null | undefined>;

// `undefined` = the session model is not in play (flag off, or the view is not
// readable); every account_login/oauth tile then resolves from the account
// row alone. A reader that returns rows (even zero) turns the model on.
export type ChannelTileSessionReader = (
  orgId: string,
) => Promise<readonly DistributionChannelSessionStatusRow[] | null | undefined>;

export async function listChannelTileStatuses(
  orgId: string,
  readAccounts: ChannelTileAccountReader,
  readSessions?: ChannelTileSessionReader,
  now: number = Date.now(),
): Promise<ChannelTileStatusRow[]> {
  const [accounts, sessions] = await Promise.all([
    readAccounts(orgId),
    readSessions ? readSessions(orgId) : Promise.resolve(undefined),
  ]);
  return buildChannelTileStatuses(accounts, sessions, now);
}

export function buildChannelTileStatuses(
  accountRows: readonly DistributionChannelAccountTileRow[] | null | undefined,
  sessionRows?: readonly DistributionChannelSessionStatusRow[] | null,
  now: number = Date.now(),
): ChannelTileStatusRow[] {
  const accountByChannel = new Map<string, ChannelTileAccount>();
  for (const row of accountRows ?? []) {
    if (!row.channel) continue;
    accountByChannel.set(row.channel, {
      account_status: row.account_status,
      automation_authorized: row.automation_authorized,
      external_account_label: row.external_account_label ?? null,
      spend_authorized: row.spend_authorized ?? null,
      spend_max_cents: row.spend_max_cents ?? null,
      spend_revoked_at: row.spend_revoked_at ?? null,
      capabilities: row.capabilities ?? null,
    });
  }

  const sessionAware = sessionRows !== undefined && sessionRows !== null;
  const sessionByChannel = new Map<string, ChannelTileSession>();
  for (const row of sessionRows ?? []) {
    if (!row.channel) continue;
    sessionByChannel.set(row.channel, {
      account_label: row.account_label,
      alive: row.alive,
      cap_used: row.cap_used,
      cap_total: row.cap_total,
      last_checked_at: row.last_checked_at,
      last_check_code: row.last_check_code,
      last_check_error: row.last_check_error,
      check_pending: row.check_pending,
      stale: row.stale,
      last_validated_at: row.last_validated_at ?? null,
    });
  }

  return CANONICAL_CHANNEL_REGISTRY.map((channel) => ({
    channel: channel.key,
    ...channelTileStatus(
      channel.key,
      accountByChannel.get(channel.key) ?? null,
      sessionAware ? sessionByChannel.get(channel.key) ?? null : undefined,
      now,
    ),
  }));
}

export function channelTileLine(
  channelKey: unknown,
  tileState: ChannelTileState,
): string {
  const label = channelByKey(channelKey)?.label ?? "This channel";

  switch (tileState) {
    case "linked":
      return `${label} is linked and authorized.`;
    case "connected_needs_authorization":
      return `${label} is connected but not authorized to post yet.`;
    case "checking":
      return `Checking your ${label} account.`;
    case "dead_session":
      return `${label} session ended. Sign in again to continue.`;
    case "cap_reached":
      return `${label} free cap reached.`;
    case "not_linked":
      return `${label} is not linked yet.`;
    case "not_available_yet":
      return `${label} is not available for connected posting yet.`;
    case "self_post":
      return `You post on ${label} yourself; Vacantless writes the ad and keeps the link.`;
    case "mls_only":
      return `${label} requires an MLS or broker route.`;
    default:
      return "This channel is not configured yet.";
  }
}
