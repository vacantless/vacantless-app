import {
  channelByKey,
  channelModeLabel,
} from "./distribution-channels";
import {
  COPILOT_STOP_GATES,
  stopGateLabel,
  stopGateNote,
  type CopilotStopGate,
} from "./distribution-copilot";
import {
  buildFillSheet,
  type FillField,
  type FillSheetInput,
} from "./listing-fill-sheet";
import { MAX_PHOTOS } from "./listing-feed";
import { buildListingCopy } from "./listing-copy";
import { guardrailsForPortal, type Guardrail } from "./listing-guardrails";

export const EXTENSION_CHANNELS = ["kijiji", "facebook"] as const;
export type ExtensionChannelKey = (typeof EXTENSION_CHANNELS)[number];

export function isExtensionChannel(
  value: unknown,
): value is ExtensionChannelKey {
  return (
    typeof value === "string" &&
    (EXTENSION_CHANNELS as readonly string[]).includes(value)
  );
}

export type ExtensionPhotoInput = {
  url: string | null;
  isCover?: boolean | null;
  sortOrder?: number | null;
};

export type ExtensionKitChannel = {
  channel: {
    key: ExtensionChannelKey;
    label: string;
    portalUrl: string;
    modeLabel: string;
  };
  fields: FillField[];
  copy: {
    title: string;
    body: string;
  };
  trackedLink: string;
  guardrails: Guardrail[];
  stopGates: Array<{
    key: CopilotStopGate;
    label: string;
    note: string;
  }>;
  photos: string[];
  distributeTabUrl: string;
};

export type ExtensionKit = {
  property: {
    id: string;
    address: string;
  };
  generatedAt: string;
  channels: ExtensionKitChannel[];
};

export type BuildExtensionKitInput = {
  property: {
    id: string;
    address: string;
  };
  listing: FillSheetInput;
  trackedLinks: Record<ExtensionChannelKey, string>;
  photos?: readonly ExtensionPhotoInput[];
  generatedAt: string;
};

function orderedPhotoUrls(
  photos: readonly ExtensionPhotoInput[] | undefined,
): string[] {
  return (photos ?? [])
    .map((photo, index) => ({
      url: typeof photo.url === "string" ? photo.url.trim() : "",
      isCover: photo.isCover === true,
      sortOrder:
        typeof photo.sortOrder === "number" && Number.isFinite(photo.sortOrder)
          ? photo.sortOrder
          : index,
      index,
    }))
    .filter((photo) => photo.url.length > 0)
    .sort((a, b) => {
      if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.index - b.index;
    })
    .slice(0, MAX_PHOTOS)
    .map((photo) => photo.url);
}

export function buildExtensionKit(
  input: BuildExtensionKitInput,
): ExtensionKit {
  const photos = orderedPhotoUrls(input.photos);
  const distributeTabUrl = `/dashboard/properties/${encodeURIComponent(
    input.property.id,
  )}#distribute`;

  return {
    property: {
      id: input.property.id,
      address: input.property.address,
    },
    generatedAt: input.generatedAt,
    channels: EXTENSION_CHANNELS.map((key) => {
      const channel = channelByKey(key);
      const label = channel?.label ?? key;
      const trackedLink = input.trackedLinks[key];
      const listing = {
        ...input.listing,
        publicUrl: trackedLink,
      };
      const copy = buildListingCopy(listing, channel?.copyKey ?? key);
      const sheet = buildFillSheet(listing, key);

      return {
        channel: {
          key,
          label,
          portalUrl: channel?.portalUrl ?? "",
          modeLabel: channelModeLabel(channel?.mode),
        },
        fields: sheet.fields,
        copy: {
          title: copy.title,
          body: copy.body,
        },
        trackedLink,
        guardrails: guardrailsForPortal(key),
        stopGates: COPILOT_STOP_GATES.map((gate) => ({
          key: gate,
          label: stopGateLabel(gate),
          note: stopGateNote(gate, label),
        })),
        photos,
        distributeTabUrl,
      };
    }),
  };
}
