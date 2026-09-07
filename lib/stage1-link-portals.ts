import {
  type ChannelConnectKind,
  type ChannelTileState,
} from "./distribution-channels";
import type { ChannelTileStatusRow } from "./distribution-channel-tile-statuses";

export type Stage1GroupId = "ready" | "coming" | "agent";
export type Stage1StatusTone = "success" | "attention" | "neutral" | "info";

export type Stage1Group = {
  id: Stage1GroupId;
  titleKey: "groupReady" | "groupComing" | "groupAgent";
  states: readonly ChannelTileState[];
};

export type Stage1GroupedRows = Stage1Group & {
  rows: ChannelTileStatusRow[];
};

export type Stage1StatusCopy = {
  titleKey:
    | "status.linked"
    | "status.connectedNeedsAuth"
    | "status.checking"
    | "status.deadSession"
    | "status.capReached"
    | "status.notLinked"
    | "status.notAvailable"
    | "status.mlsOnly";
  subKey:
    | "status.linkedSub"
    | "status.connectedNeedsAuthSub"
    | "status.checkingSub"
    | "status.deadSessionSub"
    | "status.capReachedSub"
    | "status.notLinkedSub"
    | "status.notAvailableSub"
    | "status.mlsOnlySub";
  tone: Stage1StatusTone;
};

export const STAGE1_GROUPS: readonly Stage1Group[] = [
  {
    id: "ready",
    titleKey: "groupReady",
    states: [
      "linked",
      "connected_needs_authorization",
      "checking",
      "dead_session",
      "cap_reached",
      "not_linked",
    ],
  },
  {
    id: "coming",
    titleKey: "groupComing",
    states: ["not_available_yet"],
  },
  {
    id: "agent",
    titleKey: "groupAgent",
    states: ["mls_only"],
  },
];

export const STAGE1_STATUS_COPY: Record<ChannelTileState, Stage1StatusCopy> = {
  linked: {
    titleKey: "status.linked",
    subKey: "status.linkedSub",
    tone: "success",
  },
  connected_needs_authorization: {
    titleKey: "status.connectedNeedsAuth",
    subKey: "status.connectedNeedsAuthSub",
    tone: "attention",
  },
  checking: {
    titleKey: "status.checking",
    subKey: "status.checkingSub",
    tone: "neutral",
  },
  dead_session: {
    titleKey: "status.deadSession",
    subKey: "status.deadSessionSub",
    tone: "attention",
  },
  cap_reached: {
    titleKey: "status.capReached",
    subKey: "status.capReachedSub",
    tone: "info",
  },
  not_linked: {
    titleKey: "status.notLinked",
    subKey: "status.notLinkedSub",
    tone: "attention",
  },
  not_available_yet: {
    titleKey: "status.notAvailable",
    subKey: "status.notAvailableSub",
    tone: "neutral",
  },
  mls_only: {
    titleKey: "status.mlsOnly",
    subKey: "status.mlsOnlySub",
    tone: "info",
  },
};

export const STAGE1_CONNECT_KIND_COPY: Record<
  ChannelConnectKind,
  "kindLogin" | "kindOauth" | "kindNone"
> = {
  account_login: "kindLogin",
  oauth: "kindOauth",
  none: "kindNone",
};

// Reason keys the dead-session sub line can name (stage1.reason.*). Mirrors the
// 0225 last_check_code check constraint; anything else reads as "needs_login".
export const STAGE1_REASON_KEYS = [
  "needs_login",
  "cloudflare",
  "captcha",
  "no_session",
  "timeout",
  "error",
] as const;
export type Stage1ReasonKey = (typeof STAGE1_REASON_KEYS)[number];

export function stage1ReasonKey(
  row: Pick<ChannelTileStatusRow, "lastCheckCode">,
): Stage1ReasonKey {
  const code = row.lastCheckCode;
  return (STAGE1_REASON_KEYS as readonly string[]).includes(code ?? "")
    ? (code as Stage1ReasonKey)
    : "needs_login";
}

export function stage1StatusCopy(
  state: ChannelTileState,
): Stage1StatusCopy {
  return STAGE1_STATUS_COPY[state];
}

export function groupStage1ChannelRows(
  rows: readonly ChannelTileStatusRow[],
): Stage1GroupedRows[] {
  return STAGE1_GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => group.states.includes(row.state)),
  }));
}

// The Connect / Record button renders for a channel the operator can act on:
// never linked yet, or linked once and now signed out (Reconnect).
export function canRenderStage1Connect(
  row: Pick<ChannelTileStatusRow, "state" | "canConnect"> &
    Partial<Pick<ChannelTileStatusRow, "canReconnect">>,
  connectKind: ChannelConnectKind,
): boolean {
  if (connectKind === "none") return false;
  if (row.state === "dead_session") return row.canReconnect !== false;
  return row.canConnect === true && row.state === "not_linked";
}

export function stage1ConnectHref(
  channel: string,
  connectKind: ChannelConnectKind,
): string | null {
  switch (connectKind) {
    case "oauth":
      return "/api/integrations/facebook/connect";
    case "account_login":
      return `/dashboard/settings?tab=distribution#channel-${encodeURIComponent(
        channel,
      )}`;
    case "none":
      return null;
    default:
      return null;
  }
}

// Where "Authorize automation" sends the operator: the same settings anchor
// the Connect button uses, which is where the authorize form lives.
export function stage1AuthorizeHref(channel: string): string {
  return `/dashboard/settings?tab=distribution#channel-${encodeURIComponent(
    channel,
  )}`;
}

export function stage1ConnectButtonKey(
  connectKind: ChannelConnectKind,
): "buttons.login" | "buttons.connect" | null {
  switch (connectKind) {
    case "account_login":
      return "buttons.login";
    case "oauth":
      return "buttons.connect";
    case "none":
      return null;
    default:
      return null;
  }
}
