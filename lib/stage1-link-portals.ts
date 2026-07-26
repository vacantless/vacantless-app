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
    | "status.notLinked"
    | "status.notAvailable"
    | "status.mlsOnly";
  subKey:
    | "status.linkedSub"
    | "status.notLinkedSub"
    | "status.notAvailableSub"
    | "status.mlsOnlySub";
  tone: Stage1StatusTone;
};

export const STAGE1_GROUPS: readonly Stage1Group[] = [
  {
    id: "ready",
    titleKey: "groupReady",
    states: ["linked", "not_linked"],
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

export function canRenderStage1Connect(
  row: Pick<ChannelTileStatusRow, "state" | "canConnect">,
  connectKind: ChannelConnectKind,
): boolean {
  return (
    row.canConnect === true &&
    row.state === "not_linked" &&
    connectKind !== "none"
  );
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
