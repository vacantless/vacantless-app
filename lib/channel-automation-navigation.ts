let mutationRedirectSequence = 0;

export function nextMutationRedirectToken(): string {
  mutationRedirectSequence =
    (mutationRedirectSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${mutationRedirectSequence.toString(36)}`;
}

function channelQuery(channel: string | null | undefined): string {
  const value = String(channel ?? "").trim();
  return value ? `&ch=${encodeURIComponent(value)}` : "";
}

export function propertyChannelAutomationRedirectPath(
  propertyId: string,
  msg: string,
  channel?: string | null,
): string {
  // Next 14.2.35 no-ops redirects to the loaded URL. A repeat outcome needs
  // a changing token so the App Router fetches a fresh server tree.
  const mutation = nextMutationRedirectToken();
  return `/dashboard/properties/${propertyId}?dist=${msg}&m=${mutation}${channelQuery(channel)}#distribute`;
}

export function settingsChannelAutomationRedirectPath(
  msg: string,
  channel?: string | null,
): string {
  const mutation = nextMutationRedirectToken();
  return `/dashboard/settings?tab=distribution&dist=${msg}&m=${mutation}${channelQuery(channel)}`;
}
