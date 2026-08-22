// ============================================================================
// Pure "one listing packet" readiness.
//
// Portal requirements include listing facts (rent/photos/property type) and
// posting facts (sign-in/payment/proof). This reducer answers the simpler UI
// question: "Does this one Vacantless listing contain the facts each site needs?"
// Posting-time work stays in the publish plan.
// ============================================================================

import {
  PORTAL_REQUIREMENTS,
  isPortalOperatorField,
  portalRequirementFieldLabel,
  type PortalAutomationMode,
  type PortalDistributionTier,
  type PortalRequirementChannelKey,
  type PortalRequirementFieldKey,
  type PortalRequirementSourceLevel,
} from "./portal-requirements";

export type ListingPacketFieldFacts = Partial<
  Record<PortalRequirementFieldKey, boolean>
>;

export const GENERATED_PACKET_FIELD_KEYS = [
  "post_caption",
  "tracked_link",
] as const satisfies readonly PortalRequirementFieldKey[];

const GENERATED_PACKET_FIELD_KEY_SET = new Set<string>(
  GENERATED_PACKET_FIELD_KEYS,
);

export function isGeneratedPacketField(
  key: PortalRequirementFieldKey,
): boolean {
  return GENERATED_PACKET_FIELD_KEY_SET.has(key);
}

export function isListingPacketField(
  key: PortalRequirementFieldKey,
): boolean {
  return !isPortalOperatorField(key) && !isGeneratedPacketField(key);
}

export type ListingPacketChannelReadiness = {
  channel: PortalRequirementChannelKey;
  label: string;
  tier: PortalDistributionTier;
  automationMode: PortalAutomationMode;
  sourceLevel: PortalRequirementSourceLevel;
  ready: boolean;
  requiredListingFields: PortalRequirementFieldKey[];
  missingRequired: PortalRequirementFieldKey[];
  missingRecommended: PortalRequirementFieldKey[];
  operatorFields: PortalRequirementFieldKey[];
  generatedFields: PortalRequirementFieldKey[];
};

export type ListingPacketMissingField = {
  field: PortalRequirementFieldKey;
  label: string;
  channelCount: number;
  channels: PortalRequirementChannelKey[];
};

export type ListingPacketReadiness = {
  channelCount: number;
  readyChannelCount: number;
  missingRequired: ListingPacketMissingField[];
  missingRecommended: ListingPacketMissingField[];
  operatorFieldCount: number;
  generatedFieldCount: number;
  channels: ListingPacketChannelReadiness[];
};

function unique<T extends string>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

function fieldReady(
  facts: ListingPacketFieldFacts,
  field: PortalRequirementFieldKey,
): boolean {
  return facts[field] === true;
}

function aggregateMissing(
  channels: readonly ListingPacketChannelReadiness[],
  key: "missingRequired" | "missingRecommended",
): ListingPacketMissingField[] {
  const byField = new Map<PortalRequirementFieldKey, Set<PortalRequirementChannelKey>>();
  for (const channel of channels) {
    for (const field of channel[key]) {
      const existing = byField.get(field) ?? new Set<PortalRequirementChannelKey>();
      existing.add(channel.channel);
      byField.set(field, existing);
    }
  }

  return Array.from(byField.entries())
    .map(([field, channelSet]) => ({
      field,
      label: portalRequirementFieldLabel(field),
      channelCount: channelSet.size,
      channels: Array.from(channelSet),
    }))
    .sort((a, b) => {
      if (b.channelCount !== a.channelCount) return b.channelCount - a.channelCount;
      return a.label.localeCompare(b.label);
    });
}

export function buildListingPacketReadiness(input: {
  fieldFacts: ListingPacketFieldFacts;
  channels?: readonly PortalRequirementChannelKey[];
}): ListingPacketReadiness {
  const selectedChannels = new Set(input.channels ?? []);
  const rows =
    selectedChannels.size > 0
      ? PORTAL_REQUIREMENTS.filter((row) => selectedChannels.has(row.channel))
      : PORTAL_REQUIREMENTS;

  const channels: ListingPacketChannelReadiness[] = rows.map((row) => {
    const requiredListingFields = row.required.filter(isListingPacketField);
    const recommendedListingFields = row.recommended.filter(isListingPacketField);
    const missingRequired = requiredListingFields.filter(
      (field) => !fieldReady(input.fieldFacts, field),
    );
    const missingRecommended = recommendedListingFields.filter(
      (field) => !fieldReady(input.fieldFacts, field),
    );
    const operatorFields = unique(
      [...row.required, ...row.recommended, ...row.optional].filter(
        isPortalOperatorField,
      ),
    );
    const generatedFields = unique(
      [...row.required, ...row.recommended, ...row.optional].filter(
        isGeneratedPacketField,
      ),
    );

    return {
      channel: row.channel,
      label: row.label,
      tier: row.defaultTier,
      automationMode: row.automationMode,
      sourceLevel: row.sourceLevel,
      ready: missingRequired.length === 0,
      requiredListingFields,
      missingRequired,
      missingRecommended,
      operatorFields,
      generatedFields,
    };
  });

  return {
    channelCount: channels.length,
    readyChannelCount: channels.filter((channel) => channel.ready).length,
    missingRequired: aggregateMissing(channels, "missingRequired"),
    missingRecommended: aggregateMissing(channels, "missingRecommended"),
    operatorFieldCount: unique(channels.flatMap((channel) => channel.operatorFields))
      .length,
    generatedFieldCount: unique(channels.flatMap((channel) => channel.generatedFields))
      .length,
    channels,
  };
}

