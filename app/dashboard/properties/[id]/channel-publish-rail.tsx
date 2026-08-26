import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import {
  type ConnectChip,
  type DistributionChannel,
} from "@/lib/distribution-channels";
import {
  distributionChannelContract,
  distributionLifecycleSummary,
  distributionLaunchStateLabel,
  resolveDistributionLaunchReadiness,
  type DistributionChannelContract,
  type DistributionLaunchState,
} from "@/lib/distribution-channel-contracts";
import type { PublishChannelKey } from "@/lib/distribution-publish";

export type ChannelPublishAccountRow = {
  channel: string;
  accountStatus: string | null;
  transport: string | null;
  automationAuthorized: boolean;
  autoSubmitAllowed?: boolean;
  hasFeedRoute: boolean;
  spendAuthorized?: boolean | null;
  spendMaxCents?: number | null;
  spendRevokedAt?: string | null;
};

export type ChannelPublishTierId = "instant" | "one_tap" | "gated";

export type ChannelPublishRailRow = {
  key: string;
  label: string;
  tier: ChannelPublishTierId;
  chip: ConnectChip;
  headline: string;
  lifecycleSummary: string;
  readinessState: DistributionLaunchState;
  readinessReason: string;
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

const READY_CHIP: ConnectChip = {
  state: "connected",
  label: "Ready",
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
    lifecycleSummary:
      "Follows the renter page and turns off when the rental is leased or paused.",
    readinessState: "ready",
    readinessReason: "Ready for launch.",
    automationAction: null,
    reachesRenters: live,
    live,
    synthetic: true,
    portalUrl: null,
  };
}

function contractForChannel(channel: DistributionChannel): DistributionChannelContract {
  return distributionChannelContract(channel.key as PublishChannelKey);
}

function readinessChip(state: DistributionLaunchState): ConnectChip {
  switch (state) {
    case "ready":
      return READY_CHIP;
    case "needs_account":
      return {
        state: "connect",
        label: distributionLaunchStateLabel(state),
        tone: "accent",
        canConnect: true,
      };
    case "needs_authorization":
      return {
        state: "connected",
        label: distributionLaunchStateLabel(state),
        tone: "warning",
        canConnect: false,
      };
    case "needs_spend_limit":
      return {
        state: "needs_payment",
        label: distributionLaunchStateLabel(state),
        tone: "warning",
        canConnect: true,
      };
    case "needs_broker":
      return {
        state: "mls_route",
        label: distributionLaunchStateLabel(state),
        tone: "neutral",
        canConnect: false,
      };
    case "fallback_task":
      return {
        state: "manual",
        label: distributionLaunchStateLabel(state),
        tone: "neutral",
        canConnect: false,
      };
    case "planned":
      return {
        state: "coming_soon",
        label: distributionLaunchStateLabel(state),
        tone: "neutral",
        canConnect: false,
      };
  }
}

function readyHeadline(contract: DistributionChannelContract): string {
  if (contract.executionKind === "api") {
    return "Connected and authorized. Vacantless can launch this after you approve the listing.";
  }
  if (contract.executionKind === "headless_worker") {
    return "Account and authorization are ready. Vacantless can launch this behind the scenes after approval.";
  }
  if (contract.executionKind === "feed") {
    return "Feed route is ready. Partner acceptance is still tracked separately from live proof.";
  }
  return "Ready for the launch action.";
}

function readinessHeadline(
  contract: DistributionChannelContract,
  state: DistributionLaunchState,
  reason: string,
): string {
  if (state === "ready") return readyHeadline(contract);
  if (state === "needs_account") {
    return `Connect ${contract.label} once before this destination can launch.`;
  }
  if (state === "needs_authorization") {
    return "Authorize Vacantless to post, refresh, or remove listings for this account.";
  }
  if (state === "needs_spend_limit") {
    return "Set the landlord pass-through spend limit before this paid channel can launch.";
  }
  return reason;
}

function bucketForChannel(input: {
  channel: DistributionChannel;
  account: ChannelPublishAccountRow | null;
  instagramEnabled: boolean;
  liveChannelKeys: Set<string>;
}): ChannelPublishRailRow {
  const { channel, account, instagramEnabled, liveChannelKeys } = input;
  const hasFeedRoute = account?.hasFeedRoute === true;
  const accountStatus = account?.accountStatus ?? null;
  const contract = contractForChannel(channel);
  const launchReadiness =
    channel.key === "instagram" && !instagramEnabled
      ? {
          channel: "instagram" as PublishChannelKey,
          label: channel.label,
          state: "planned" as const,
          reason: "Instagram publishing is dark until the channel is enabled for this org.",
        }
      : resolveDistributionLaunchReadiness(contract, {
          accountStatus,
          automationAuthorized: account?.automationAuthorized === true,
          spendAuthorized: account?.spendAuthorized === true,
          spendMaxCents: account?.spendMaxCents ?? null,
          spendRevokedAt: account?.spendRevokedAt ?? null,
          feedAccepted: hasFeedRoute,
        });
  const needsAutomationAuthorization =
    accountStatus === "connected" &&
    account?.automationAuthorized !== true &&
    channel.mode === "api_automatic" &&
    !(channel.key === "instagram" && !instagramEnabled);
  const chip: ConnectChip =
    needsAutomationAuthorization
      ? {
          state: "connected",
          label: "Needs authorization",
          tone: "warning",
          canConnect: false,
        }
      : readinessChip(launchReadiness.state);
  const automationAction: ChannelPublishRailRow["automationAction"] =
    needsAutomationAuthorization
      ? "authorize"
      : accountStatus === "connected" &&
          account?.automationAuthorized === true &&
          channel.mode === "api_automatic"
        ? "revoke"
        : null;
  let tier: ChannelPublishTierId = "gated";
  if (launchReadiness.state === "ready") {
    tier = "instant";
  } else if (launchReadiness.state === "fallback_task") {
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
          : readinessHeadline(
              contract,
              launchReadiness.state,
              launchReadiness.reason,
          );
  const lifecycle = distributionLifecycleSummary(contract);

  return {
    key: channel.key,
    label: channel.label,
    tier,
    chip,
    headline,
    lifecycleSummary: lifecycle.detail,
    readinessState: launchReadiness.state,
    readinessReason: launchReadiness.reason,
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
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
            {row.lifecycleSummary}
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
            Site access
          </summary>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Open the site only when it needs native controls, sign-in, payment,
            final review, or removal proof.
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
      label: "Ready",
      value: buckets.instant.length,
      detail: "launches after approval",
    },
    {
      label: "Fallback",
      value: buckets.oneTap.length,
      detail: "exception tasks",
    },
    {
      label: "Setup",
      value: buckets.gated.length,
      detail: "account, auth, or spend",
    },
  ];
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Launch plan
          </p>
          <h3 className="mt-1 text-lg font-semibold text-gray-950">
            Launch everywhere from one listing.
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            Ready destinations launch from Vacantless. Account, authorization,
            spend, and proof exceptions stay explicit before anything posts.
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
          title="Ready to launch"
          rows={buckets.instant}
          defaultOpen={false}
          actionForRow={actionForRow}
        />
        <TierCard
          title="Fallback tasks"
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
          title="Account and spend setup"
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
