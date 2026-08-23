import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import {
  channelConnectChip,
  channelTileStatus,
  getOnlineAssistKindForChannel,
  type ConnectChip,
  type DistributionChannel,
} from "@/lib/distribution-channels";
import { channelCapability } from "@/lib/distribution-capabilities";

export type ChannelPublishAccountRow = {
  channel: string;
  accountStatus: string | null;
  transport: string | null;
  automationAuthorized: boolean;
  autoSubmitAllowed?: boolean;
  hasFeedRoute: boolean;
};

export type ChannelPublishTierId = "instant" | "one_tap" | "gated";

export type ChannelPublishRailRow = {
  key: string;
  label: string;
  tier: ChannelPublishTierId;
  chip: ConnectChip;
  headline: string;
  automationAction: "authorize" | "revoke" | null;
  reachesRenters: boolean;
  live: boolean;
  synthetic: boolean;
  portalUrl: string | null;
};

export type ChannelPublishRailBuckets = {
  instant: ChannelPublishRailRow[];
  oneTap: ChannelPublishRailRow[];
  gated: ChannelPublishRailRow[];
  /** Every reaching row, including synthetic Vacantless-page/email rows. */
  liveCount: number;
  /** Every row, including synthetic rows. */
  totalCount: number;
  /** Outside sites only. Synthetic Vacantless-page/email rows are excluded. */
  externalLiveCount: number;
  /** Outside sites only. Synthetic Vacantless-page/email rows are excluded. */
  externalTotalCount: number;
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
    automationAction: null,
    reachesRenters: live,
    live,
    synthetic: true,
    portalUrl: null,
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
  const needsAutomationAuthorization =
    accountStatus === "connected" &&
    account?.automationAuthorized !== true &&
    channel.mode === "api_automatic" &&
    !(channel.key === "instagram" && !instagramEnabled);
  const postingAssistChip: ConnectChip = {
    state: "manual",
    label: "Posting assist",
    tone: "neutral",
    canConnect: false,
  };
  const paidPostingAssistChip: ConnectChip = {
    state: "needs_payment",
    label: "Needs payment",
    tone: "warning",
    canConnect: true,
  };
  const assistKind = getOnlineAssistKindForChannel(channel);
  // Some channels have no real account connection yet, but still have a useful,
  // proof-gated posting-assist route in Get online. Keep Settings honest
  // ("planned"/not connectable) while the property rail shows the actual next tap.
  const chip: ConnectChip =
    needsAutomationAuthorization
      ? {
          state: "connected",
          label: "Needs authorization",
          tone: "warning",
          canConnect: false,
        }
      : assistKind === "posting_assist" && baseChip.state === "coming_soon"
      ? postingAssistChip
      : assistKind === "paid_posting_assist" && baseChip.state === "coming_soon"
      ? paidPostingAssistChip
      : baseChip.state === "connect" &&
          (channel.mode === "assisted_manual" ||
            (channel.mode === "feed_or_assisted" && !hasFeedRoute))
        ? postingAssistChip
      : baseChip;
  const tile = channelTileStatus(channel.key, {
    account_status: accountStatus,
    automation_authorized: account?.automationAuthorized === true,
  });
  const automationAction: ChannelPublishRailRow["automationAction"] =
    needsAutomationAuthorization
      ? "authorize"
      : accountStatus === "connected" &&
          account?.automationAuthorized === true &&
          channel.mode === "api_automatic"
        ? "revoke"
        : null;
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
  const headline =
    channel.key === "instagram" && !instagramEnabled
      ? "Dark until Instagram publishing is enabled."
      : needsAutomationAuthorization
        ? "Connected; authorize Vacantless to post this listing to this account when you publish."
        : automationAction === "revoke"
          ? "Authorized; this account receives a post when you publish and approve."
          : chip.state === "manual" && channel.mode === "feed_or_assisted"
            ? "Use posting assist until a feed route is connected."
          : channel.key === "rentfaster" && chip.state === "needs_payment"
            ? "Vacantless prepares the RentFaster post; you approve any fee and save the real live URL."
          : chip.state === "manual"
            ? "Vacantless prepares it; you review, post, and save the live URL."
          : tile.headline;

  return {
    key: channel.key,
    label: channel.label,
    tier,
    chip,
    headline,
    automationAction,
    reachesRenters: tier === "instant" && live,
    live,
    synthetic: false,
    portalUrl: channel.portalUrl,
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
    externalLiveCount: [...instant, ...oneTap, ...gated].filter(
      (row) => !row.synthetic && row.reachesRenters,
    ).length,
    externalTotalCount: [...instant, ...oneTap, ...gated].filter(
      (row) => !row.synthetic,
    ).length,
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
    <li className="border-t border-gray-100 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-h-12 items-center justify-between gap-3">
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
      </div>
      {row.portalUrl ? (
        <details className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-semibold text-gray-600 [&::-webkit-details-marker]:hidden">
            Use this site yourself
          </summary>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Vacantless keeps the copy ready. Open the portal when this site
            needs native controls, payment, sign-in, or final review.
          </p>
          <a
            href={row.portalUrl}
            target="_blank"
            rel="noreferrer"
            title={`Open ${row.label} directly`}
            aria-label={`Open ${row.label} directly`}
            className="mt-2 inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Icons.link className="h-3.5 w-3.5" />
            <span>Open site</span>
          </a>
        </details>
      ) : null}
    </li>
  );
}

function TierCard({
  title,
  rows,
  children,
  defaultOpen = true,
  actionForRow,
}: {
  title: string;
  rows: ChannelPublishRailRow[];
  children?: ReactNode;
  defaultOpen?: boolean;
  actionForRow?: (row: ChannelPublishRailRow) => ReactNode;
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
          <ChannelRow key={row.key} row={row} action={actionForRow?.(row)} />
        ))}
      </ul>
      {children}
    </details>
  );
}

export function ChannelPublishRail({
  buckets,
  oneTapFooter,
  actionForRow,
}: {
  buckets: ChannelPublishRailBuckets;
  oneTapFooter?: ReactNode;
  actionForRow?: (row: ChannelPublishRailRow) => ReactNode;
}) {
  const ringLiveLabel = `${buckets.externalLiveCount} live`;
  const ringTotalLabel = `${buckets.externalTotalCount} ${
    buckets.externalTotalCount === 1 ? "site" : "sites"
  }`;
  const planCards = [
    {
      label: "Included",
      value: buckets.instant.length,
      detail: "runs after approval",
    },
    {
      label: "Needs your tap",
      value: buckets.oneTap.length,
      detail: "sign-in, payment, or proof",
    },
    {
      label: "Top-up / setup",
      value: buckets.gated.length,
      detail: "paid, connected, or broker route",
    },
  ];
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Posting plan
          </p>
          <h3 className="mt-1 text-lg font-semibold text-gray-950">
            Vacantless posts first; you handle exceptions.
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            Included routes stay automated. Sign-in, payment, approval, and
            proof appear only when a site needs them.
          </p>
        </div>
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4 border-green-600 text-green-700">
          <span className="text-sm font-bold">{ringLiveLabel}</span>
          <span className="text-center text-[10px] font-semibold leading-none">
            {ringTotalLabel}
          </span>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {planCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {card.label}
            </p>
            <p className="mt-1 text-lg font-semibold text-gray-950">
              {card.value}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <TierCard
          title="Included automation"
          rows={buckets.instant}
          defaultOpen={false}
          actionForRow={actionForRow}
        />
        <TierCard
          title="Needs sign-in, payment, or proof"
          rows={buckets.oneTap}
          defaultOpen={false}
        >
          {oneTapFooter ? (
            <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-gray-700">
              {oneTapFooter}
            </div>
          ) : null}
        </TierCard>
        <TierCard
          title="Top-up / account setup"
          rows={buckets.gated}
          defaultOpen={false}
          actionForRow={actionForRow}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-800">
        <Icons.bolt className="h-4 w-4" />
        <span>
          Nothing is posted, paid, or marked Live without approval and proof.
        </span>
      </div>
    </section>
  );
}
