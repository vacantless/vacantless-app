import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import {
  channelConnectChip,
  channelTileStatus,
  type ConnectChip,
  type DistributionChannel,
} from "@/lib/distribution-channels";
import { channelCapability } from "@/lib/distribution-capabilities";

export type ChannelPublishAccountRow = {
  channel: string;
  accountStatus: string | null;
  transport: string | null;
  automationAuthorized: boolean;
  hasFeedRoute: boolean;
};

export type ChannelPublishTierId = "instant" | "one_tap" | "gated";

export type ChannelPublishRailRow = {
  key: string;
  label: string;
  tier: ChannelPublishTierId;
  chip: ConnectChip;
  headline: string;
  reachesRenters: boolean;
  live: boolean;
  synthetic: boolean;
};

export type ChannelPublishRailBuckets = {
  instant: ChannelPublishRailRow[];
  oneTap: ChannelPublishRailRow[];
  gated: ChannelPublishRailRow[];
  liveCount: number;
  totalCount: number;
};

const SYNTHETIC_CHIP: ConnectChip = {
  state: "always_on",
  label: "On",
  tone: "positive",
  canConnect: false,
};

const CHIP_CLASS: Record<ConnectChip["tone"], string> = {
  positive: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-gray-100 text-gray-600",
  accent: "bg-blue-50 text-blue-700",
};

function accountMap(rows: ChannelPublishAccountRow[]) {
  return new Map(rows.map((row) => [row.channel, row]));
}

function syntheticRow(
  key: string,
  label: string,
  live: boolean,
): ChannelPublishRailRow {
  return {
    key,
    label,
    tier: "instant",
    chip: SYNTHETIC_CHIP,
    headline: live ? "Live with the renter page." : "Turns on with Publish.",
    reachesRenters: live,
    live,
    synthetic: true,
  };
}

function bucketForChannel(input: {
  channel: DistributionChannel;
  account: ChannelPublishAccountRow | null;
  instagramEnabled: boolean;
  liveChannelKeys: Set<string>;
}): ChannelPublishRailRow {
  const { channel, account, instagramEnabled, liveChannelKeys } = input;
  const capability = channelCapability(channel.key);
  const hasFeedRoute = account?.hasFeedRoute === true;
  const accountStatus = account?.accountStatus ?? null;
  const baseChip =
    channel.key === "instagram" && !instagramEnabled
      ? {
          state: "coming_soon",
          label: "Coming soon",
          tone: "neutral",
          canConnect: false,
        } satisfies ConnectChip
      : channelConnectChip({
          integrationStatus: channel.integrationStatus,
          transport: account?.transport ?? capability.transport,
          needsOrgAccount: capability.needsOrgAccount,
          accountStatus,
          hasFeedRoute,
        });
  // Facebook Marketplace is a working guided-posting (browser_copilot) channel
  // today even though it has no API integration (integrationStatus "planned").
  // Don't let the shared "planned -> Coming soon" verdict mislabel it as
  // unavailable; show the honest guided-posting chip so it matches its
  // "1 tap to finish" placement. Scope: rail only — the Settings tile stays
  // "not available yet", which is correct (there is no account to connect).
  const chip: ConnectChip =
    channel.key === "facebook" && baseChip.state === "coming_soon"
      ? { state: "manual", label: "Guided posting", tone: "neutral", canConnect: false }
      : baseChip;
  const tile = channelTileStatus(channel.key, {
    account_status: accountStatus,
    automation_authorized: account?.automationAuthorized === true,
  });
  const apiReady =
    channel.mode === "api_automatic" &&
    chip.state === "connected" &&
    tile.state === "linked";
  const feedReady = channel.mode === "feed_or_assisted" && hasFeedRoute;
  const unavailable =
    chip.state === "coming_soon" || chip.state === "mls_route";
  let tier: ChannelPublishTierId = "gated";
  if (channel.key === "instagram" && !instagramEnabled) {
    tier = "gated";
  } else if (apiReady || feedReady) {
    tier = "instant";
  } else if (channel.key === "facebook") {
    tier = "one_tap";
  } else if (unavailable) {
    tier = "gated";
  } else if (
    channel.mode === "api_automatic" &&
    (chip.state === "connect" || chip.state === "connected")
  ) {
    tier = "gated";
  } else if (
    (channel.mode === "assisted_manual" &&
      channel.integrationStatus === "live") ||
    (channel.mode === "assisted_manual" && chip.state === "connect") ||
    (channel.mode === "feed_or_assisted" && !hasFeedRoute) ||
    chip.state === "manual" ||
    chip.state === "needs_login" ||
    chip.state === "needs_payment"
  ) {
    tier = "one_tap";
  }
  const live = liveChannelKeys.has(channel.key);

  return {
    key: channel.key,
    label: channel.label,
    tier,
    chip,
    headline:
      channel.key === "instagram" && !instagramEnabled
        ? "Dark until Instagram publishing is enabled."
        : accountStatus === "connected" &&
            account?.automationAuthorized !== true &&
            channel.mode === "api_automatic"
          ? "Connected; review and authorize before posting."
        : tile.headline,
    reachesRenters: tier === "instant" && live,
    live,
    synthetic: false,
  };
}

export function buildChannelPublishRailBuckets(input: {
  channels: readonly DistributionChannel[];
  accountRows: ChannelPublishAccountRow[];
  linkIsLive: boolean;
  liveChannelKeys?: Iterable<string>;
  instagramEnabled?: boolean;
}): ChannelPublishRailBuckets {
  const accounts = accountMap(input.accountRows);
  const liveChannelKeys = new Set(input.liveChannelKeys ?? []);
  const instant: ChannelPublishRailRow[] = [
    syntheticRow("vacantless_page", "Vacantless page", input.linkIsLive),
    syntheticRow("email_alerts", "Email alerts", input.linkIsLive),
  ];
  const oneTap: ChannelPublishRailRow[] = [];
  const gated: ChannelPublishRailRow[] = [];

  for (const channel of input.channels) {
    const row = bucketForChannel({
      channel,
      account: accounts.get(channel.key) ?? null,
      instagramEnabled: input.instagramEnabled === true,
      liveChannelKeys,
    });
    if (row.tier === "instant") instant.push(row);
    else if (row.tier === "one_tap") oneTap.push(row);
    else gated.push(row);
  }

  return {
    instant,
    oneTap,
    gated,
    liveCount: [...instant, ...oneTap, ...gated].filter((row) => row.reachesRenters)
      .length,
    totalCount: instant.length + oneTap.length + gated.length,
  };
}

function ChannelRow({
  row,
  action,
}: {
  row: ChannelPublishRailRow;
  action?: ReactNode;
}) {
  const statusLabel = row.live ? "Live" : row.chip.label;
  return (
    <li className="flex min-h-12 items-center justify-between gap-3 border-t border-gray-100 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-950">
          {row.label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
          {row.headline}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${CHIP_CLASS[row.live ? "positive" : row.chip.tone]}`}
        >
          {statusLabel}
        </span>
      </div>
    </li>
  );
}

function TierCard({
  title,
  rows,
  children,
  defaultOpen = true,
}: {
  title: string;
  rows: ChannelPublishRailRow[];
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-950">{title}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
          {rows.length}
        </span>
      </summary>
      <ul className="mt-3">
        {rows.map((row) => (
          <ChannelRow key={row.key} row={row} />
        ))}
      </ul>
      {children}
    </details>
  );
}

export function ChannelPublishRail({
  buckets,
  oneTapFooter,
}: {
  buckets: ChannelPublishRailBuckets;
  oneTapFooter?: ReactNode;
}) {
  const ringLabel = `${buckets.liveCount}/${buckets.totalCount}`;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Channel reach
          </p>
          <h3 className="mt-1 text-lg font-semibold text-gray-950">
            Publish to all channels
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            Publishes instantly where connected. Opens 1-tap finish for the rest.
          </p>
        </div>
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-green-600 text-sm font-bold text-green-700">
          {ringLabel}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <TierCard title="Publishes instantly" rows={buckets.instant} />
        <TierCard title="1 tap to finish" rows={buckets.oneTap} defaultOpen>
          {oneTapFooter ? (
            <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-gray-700">
              {oneTapFooter}
            </div>
          ) : null}
        </TierCard>
        <TierCard title="Connect / gated" rows={buckets.gated} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-800">
        <Icons.bolt className="h-4 w-4" />
        <span>
          Auto-sync is scoped to connected instant channels only.
        </span>
      </div>
    </section>
  );
}
