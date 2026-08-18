import type { PropertyStatus } from "./listing-state";

export type ArchivePropertyStatusUpdate = {
  archived_at: string;
  status_before_archive: PropertyStatus | null;
  status?: PropertyStatus;
};

export type UnarchivePropertyStatusUpdate = {
  archived_at: null;
  status_before_archive: null;
  status?: PropertyStatus;
};

export function hardDeletable(
  status: string,
  leadCount: number,
  tenancyCount: number,
  postCount: number,
): boolean {
  return (
    (status === "draft" || status === "off_market") &&
    leadCount === 0 &&
    tenancyCount === 0 &&
    postCount === 0
  );
}

export function archivePropertyStatusUpdate(
  status: PropertyStatus | null,
  archivedAt: string,
): ArchivePropertyStatusUpdate {
  const next: ArchivePropertyStatusUpdate = {
    archived_at: archivedAt,
    status_before_archive: null,
  };
  if (status === "available" || status === "paused") {
    next.status = "off_market";
    next.status_before_archive = status;
  }
  return next;
}

export function unarchivePropertyStatusUpdate(row: {
  status: PropertyStatus | null;
  status_before_archive: PropertyStatus | null;
}): UnarchivePropertyStatusUpdate {
  const next: UnarchivePropertyStatusUpdate = {
    archived_at: null,
    status_before_archive: null,
  };
  if (row.status === "off_market" && row.status_before_archive) {
    next.status = row.status_before_archive;
  }
  return next;
}
