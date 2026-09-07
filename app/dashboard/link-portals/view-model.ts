import { getFormatter, getTranslations } from "next-intl/server";
import {
  channelByKey,
  formatChannelMoney,
  type ChannelConnectKind,
  type ChannelTileState,
} from "@/lib/distribution-channels";
import type { ChannelTileStatusRow } from "@/lib/distribution-channel-tile-statuses";
import {
  canRenderStage1Connect,
  groupStage1ChannelRows,
  stage1AuthorizeHref,
  stage1ConnectButtonKey,
  stage1ConnectHref,
  stage1ReasonKey,
  stage1StatusCopy,
  STAGE1_CONNECT_KIND_COPY,
  type Stage1GroupId,
  type Stage1StatusTone,
} from "@/lib/stage1-link-portals";
import { assertSupportedLocale } from "@/lib/i18n/locale";
import { listChannelTileStatuses } from "../properties/actions";

// Server-side view model for the Stage 1 tiles. Every string the client tile
// shows is resolved here (client components in this app do not carry the
// next-intl provider), so the same builder serves the page render and the
// poll action. Nothing here writes.

export type LinkPortalTileButton = {
  kind: "connect" | "reconnect" | "authorize";
  href: string;
  label: string;
};

export type LinkPortalTileVM = {
  channel: string;
  label: string;
  connectKind: ChannelConnectKind;
  state: ChannelTileState;
  tone: Stage1StatusTone;
  title: string;
  sub: string;
  kindLine: string;
  accountLine: string | null;
  checkedLine: string | null;
  capLine: string | null;
  costLine: string | null;
  button: LinkPortalTileButton | null;
  igNote: string | null;
  needsCheck: boolean;
  lastCheckedAt: string | null;
  kijijiTier: {
    prompt: string;
    personal: string;
    business: string;
    save: string;
  } | null;
};

export type LinkPortalsGroupVM = {
  id: Stage1GroupId;
  title: string;
  rows: LinkPortalTileVM[];
};

export type LinkPortalsVM = {
  groups: LinkPortalsGroupVM[];
  // True only with DISTRIBUTION_WIZARD_ENABLED=1: the client may POST a check
  // and poll. Off = render once from rows, never write (acceptance 3).
  probeEnabled: boolean;
  generatedAt: string;
};

export function linkPortalsProbeEnabled(): boolean {
  return process.env.DISTRIBUTION_WIZARD_ENABLED === "1";
}

export async function buildLinkPortalsViewModel(
  orgId: string,
  locale: string,
): Promise<LinkPortalsVM> {
  const [rows, t, format] = await Promise.all([
    listChannelTileStatuses(orgId),
    getTranslations("stage1"),
    getFormatter(),
  ]);
  const now = new Date();
  const probeEnabled = linkPortalsProbeEnabled();
  const moneyLocale = assertSupportedLocale(locale) === "fr" ? "fr" : "en";

  const toVM = (row: ChannelTileStatusRow): LinkPortalTileVM | null => {
    const channel = channelByKey(row.channel);
    if (!channel) return null;

    const copy = stage1StatusCopy(row.state);
    const label = row.accountLabel ?? channel.label;
    const reason = t(`reason.${stage1ReasonKey(row)}`);
    const capCost = row.costCap;

    const showConnect = canRenderStage1Connect(row, channel.connectKind);
    const connectHref = stage1ConnectHref(row.channel, channel.connectKind);
    const buttonKey = stage1ConnectButtonKey(channel.connectKind);
    let button: LinkPortalTileButton | null = null;
    if (row.state === "dead_session" && showConnect && connectHref) {
      button = {
        kind: "reconnect",
        href: connectHref,
        label: t("buttons.reconnect", { name: channel.label }),
      };
    } else if (showConnect && connectHref && buttonKey) {
      button = {
        kind: "connect",
        href: connectHref,
        label: t(buttonKey, { name: channel.label }),
      };
    } else if (row.state === "connected_needs_authorization") {
      button = {
        kind: "authorize",
        href: stage1AuthorizeHref(row.channel),
        label: t("buttons.authorize"),
      };
    }

    const hasAccount =
      row.state !== "not_linked" &&
      row.state !== "not_available_yet" &&
      row.state !== "mls_only";

    const accountLine =
      hasAccount && row.accountLabel
        ? t("account.connectedAs", { label: row.accountLabel })
        : null;
    // With the flag off nothing will ever check, so "Not checked yet" would
    // be a permanent, meaningless line; show a check only when one exists.
    const checkedLine = !hasAccount || channel.connectKind === "none" || !probeEnabled
      ? null
      : row.lastCheckedAt
        ? t("account.lastChecked", {
            ago: format.relativeTime(new Date(row.lastCheckedAt), now),
          })
        : t("account.neverChecked");

    // Cap and cost lines through the locale, same keys as the pure resolver.
    const capLine = hasAccount && capCost.cap
      ? t(`cap.${capCost.cap.key}`, { used: capCost.cap.used ?? 0 })
      : hasAccount
        ? row.capLine
        : null;
    const costLine = hasAccount && capCost.cost
      ? t(`cost.${capCost.cost.key}`, {
          price: formatChannelMoney(capCost.cost.priceCents ?? 0, moneyLocale),
        }) + (capCost.spendSuffix ? ` ${t("cost.spendSuffix")}` : "")
      : hasAccount
        ? row.costLine
        : null;

    const sub = t(copy.subKey, {
      label,
      name: channel.label,
      reason,
      capLine: capLine ?? "",
    });

    const kijijiTier =
      probeEnabled && channel.key === "kijiji" && hasAccount && row.kijijiTier == null
        ? {
            prompt: t("cap.kijijiTierUnknown"),
            personal: t("kijijiTier.personal"),
            business: t("kijijiTier.business"),
            save: t("kijijiTier.save"),
          }
        : null;

    return {
      channel: row.channel,
      label: channel.label,
      connectKind: channel.connectKind,
      state: row.state,
      tone: copy.tone,
      title: t(copy.titleKey),
      sub,
      kindLine: t(STAGE1_CONNECT_KIND_COPY[channel.connectKind]),
      accountLine,
      checkedLine,
      capLine,
      costLine,
      button,
      igNote: channel.key === "instagram" ? t("igNote") : null,
      needsCheck: row.needsCheck,
      lastCheckedAt: row.lastCheckedAt,
      kijijiTier,
    };
  };

  const groups = groupStage1ChannelRows(rows)
    .map((group) => ({
      id: group.id,
      title: t(group.titleKey),
      rows: group.rows.map(toVM).filter((vm): vm is LinkPortalTileVM => vm !== null),
    }))
    .filter((group) => group.rows.length > 0);

  return {
    groups,
    probeEnabled,
    generatedAt: now.toISOString(),
  };
}
