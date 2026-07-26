import {
  isListingPostStatus,
  type ListingPostStatus,
} from "./listing-distribution";

export type AfterLiveLeadRow = {
  id: string;
  organization_id: string | null;
  property_id: string | null;
  source: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string | null;
};

export type AfterLiveListingPostRow = {
  portal: string;
  status: string | null;
  created_at?: string | null;
};

export type AfterLiveSummary = {
  leads: Array<{
    id: string;
    channel: string | null;
    name: string | null;
    receivedOn: string | null;
  }>;
  channels: Array<{
    channel: string;
    postStatus: ListingPostStatus;
    takenDown: boolean;
  }>;
  leasedUp: boolean;
};

export function buildAfterLiveSummary(
  leadRows: readonly AfterLiveLeadRow[],
  postRows: readonly AfterLiveListingPostRow[],
): AfterLiveSummary {
  const leads = [...leadRows]
    .sort((a, b) => compareCreatedDesc(a.created_at, b.created_at))
    .map((lead) => ({
      id: lead.id,
      channel: nonBlank(lead.source),
      name: firstNonBlank(lead.name, lead.email, lead.phone),
      receivedOn: lead.created_at ?? null,
    }));

  const channels = postRows.flatMap((post) => {
    const postStatus = realListingPostStatus(post.status);
    if (!postStatus) return [];
    return [
      {
        channel: post.portal,
        postStatus,
        takenDown: listingPostTakenDown(postStatus),
      },
    ];
  });

  return {
    leads,
    channels,
    leasedUp: channels.length > 0 && channels.every((channel) => channel.takenDown),
  };
}

export function listingPostTakenDown(status: ListingPostStatus): boolean {
  return status === "removed";
}

function realListingPostStatus(status: string | null): ListingPostStatus | null {
  return isListingPostStatus(status) ? status : null;
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const found = nonBlank(value);
    if (found) return found;
  }
  return null;
}

function compareCreatedDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b.localeCompare(a);
}
