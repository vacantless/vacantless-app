import {
  DISTRIBUTION_CHANNELS,
  type DistributionChannel,
} from "./distribution-channels";

export type ChannelPublishAutofireRunItem = {
  id: string;
  channel: string | null;
  mode: string | null;
  publishStatus: string | null;
};

export type ChannelPublishAutofireAccountRow = {
  channel: string | null;
  accountStatus: string | null;
  automationAuthorized: boolean | null;
};

export type ChannelPublishAutofireItem = {
  id: string;
  channel: string;
  label: string;
};

const NON_AUTOFIRE_STATUSES = new Set([
  "blocked",
  "live",
  "skipped",
  "submitted",
  "submitting",
]);

export function selectChannelPublishAutofireItems(input: {
  runItems: ChannelPublishAutofireRunItem[];
  accountRows: ChannelPublishAutofireAccountRow[];
  instagramEnabled?: boolean;
  channels?: readonly DistributionChannel[];
}): ChannelPublishAutofireItem[] {
  const channelsByKey = new Map<string, DistributionChannel>(
    (input.channels ?? DISTRIBUTION_CHANNELS).map((channel) => [
      channel.key,
      channel,
    ]),
  );
  const accountsByChannel = new Map(
    input.accountRows
      .filter((row) => typeof row.channel === "string" && row.channel.trim())
      .map((row) => [row.channel as string, row]),
  );
  const selected: ChannelPublishAutofireItem[] = [];
  const seen = new Set<string>();

  for (const item of input.runItems) {
    const key = typeof item.channel === "string" ? item.channel : "";
    if (!key || seen.has(key)) continue;
    const channel = channelsByKey.get(key);
    if (!channel || channel.mode !== "api_automatic") continue;
    if (key === "instagram" && input.instagramEnabled !== true) continue;
    if (item.mode !== "automatic") continue;
    if (NON_AUTOFIRE_STATUSES.has(item.publishStatus ?? "")) continue;

    const account = accountsByChannel.get(key);
    if (
      account?.accountStatus !== "connected" ||
      account.automationAuthorized !== true
    ) {
      continue;
    }

    selected.push({ id: item.id, channel: key, label: channel.label });
    seen.add(key);
  }

  return selected;
}
