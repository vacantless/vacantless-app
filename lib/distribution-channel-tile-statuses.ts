import {
  CANONICAL_CHANNEL_REGISTRY,
  channelByKey,
  channelTileStatus,
  type ChannelTileAccount,
  type ChannelTileState,
  type ChannelTileStatus,
} from "./distribution-channels";

export type DistributionChannelAccountTileRow = {
  channel: string | null;
  account_status: string | null;
  automation_authorized: boolean | null;
};

export type ChannelTileStatusRow = {
  channel: string;
} & ChannelTileStatus;

export type ChannelTileAccountReader = (
  orgId: string,
) => Promise<readonly DistributionChannelAccountTileRow[] | null | undefined>;

export async function listChannelTileStatuses(
  orgId: string,
  readAccounts: ChannelTileAccountReader,
): Promise<ChannelTileStatusRow[]> {
  return buildChannelTileStatuses(await readAccounts(orgId));
}

export function buildChannelTileStatuses(
  accountRows: readonly DistributionChannelAccountTileRow[] | null | undefined,
): ChannelTileStatusRow[] {
  const accountByChannel = new Map<string, ChannelTileAccount>();
  for (const row of accountRows ?? []) {
    if (!row.channel) continue;
    accountByChannel.set(row.channel, {
      account_status: row.account_status,
      automation_authorized: row.automation_authorized,
    });
  }

  return CANONICAL_CHANNEL_REGISTRY.map((channel) => ({
    channel: channel.key,
    ...channelTileStatus(channel.key, accountByChannel.get(channel.key) ?? null),
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
    case "not_linked":
      return `${label} is not linked yet.`;
    case "not_available_yet":
      return `${label} is not available for connected posting yet.`;
    case "mls_only":
      return `${label} requires an MLS or broker route.`;
    default:
      return "This channel is not configured yet.";
  }
}
