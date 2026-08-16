import {
  channelByKey,
  type DistributionChannel,
} from "./distribution-channels";
import {
  PUBLISH_CHANNEL_KEYS,
  publishChannelChoices,
  type PublishChannelKey,
} from "./distribution-publish";
import { envFlagEnabled } from "./auto-listing-copy";
import { igChannelEnabledForOrg } from "./facebook-page-oauth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AutoDistributionAccountRow = {
  channel: string | null;
  account_status: string | null;
  automation_authorized: boolean | null;
};

function clean(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function normalizeOrgId(value: string | null | undefined): string | null {
  const orgId = clean(value)?.toLowerCase() ?? null;
  return orgId && UUID_RE.test(orgId) ? orgId : null;
}

export function parseAutoDistributionOrgAllowlist(
  value: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const raw of String(value ?? "").split(",")) {
    const orgId = normalizeOrgId(raw);
    if (orgId) ids.add(orgId);
  }
  return ids;
}

const AUTO_DISTRIBUTION_ORG_ALLOWLIST = parseAutoDistributionOrgAllowlist(
  process.env.AUTO_DISTRIBUTION_ORG_ALLOWLIST,
);

export function autoDistributionEnabledForOrg(
  organizationId: string | null | undefined,
  allowlist: ReadonlySet<string> = AUTO_DISTRIBUTION_ORG_ALLOWLIST,
): boolean {
  if (!envFlagEnabled(process.env.AUTO_DISTRIBUTION_ENABLED)) return false;
  if (allowlist.size === 0) return true;
  const orgId = normalizeOrgId(organizationId);
  return orgId ? allowlist.has(orgId) : false;
}

function defaultAutoDistributionChannelKeys(
  includeNetworkFeed: boolean,
): Set<PublishChannelKey> {
  const keys = new Set<PublishChannelKey>();
  for (const channel of publishChannelChoices({ includeNetworkFeed })) {
    if (channel.key === "network_feed") {
      if (includeNetworkFeed) keys.add(channel.key);
      continue;
    }
    if (
      channel.defaultSelected &&
      channel.key !== "vacantless" &&
      channel.key !== "org_feed"
    ) {
      keys.add(channel.key);
    }
  }
  return keys;
}

function accountAuthorizedForAutomaticPublish(
  account: AutoDistributionAccountRow,
  channel: DistributionChannel,
): boolean {
  return (
    channel.mode === "api_automatic" &&
    account.account_status === "connected" &&
    account.automation_authorized === true
  );
}

export function autoDistributionChannels({
  organizationId,
  accountRows = [],
  includeNetworkFeed = Boolean(process.env.NETWORK_FEED_TOKEN?.trim()),
  instagramAllowlist,
}: {
  organizationId: string | null | undefined;
  accountRows?: readonly AutoDistributionAccountRow[];
  includeNetworkFeed?: boolean;
  instagramAllowlist?: ReadonlySet<string>;
}): PublishChannelKey[] {
  const selected = defaultAutoDistributionChannelKeys(includeNetworkFeed);

  for (const account of accountRows) {
    const rawKey = String(account.channel ?? "").trim();
    const channel = channelByKey(rawKey);
    if (!channel || !accountAuthorizedForAutomaticPublish(account, channel)) {
      continue;
    }
    if (
      channel.key === "instagram" &&
      !igChannelEnabledForOrg(organizationId, instagramAllowlist)
    ) {
      continue;
    }
    selected.add(channel.key);
  }

  return PUBLISH_CHANNEL_KEYS.filter((key) => selected.has(key));
}
