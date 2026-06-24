// Pure helpers for operator-attached work-order photos (S328). Media VALIDATION
// + MIME/size rules are shared with the tenant incident flow (lib/incident-media)
// since both land in the same private bucket; this module only adds the
// work-order PATH convention and the per-work-order cap. No DB / I/O here.

import { MAX_IMAGE_BYTES } from "./incident-media";

// Keep operators to a sensible number of photos per job (the trade needs a few
// representative shots, not an album). Mirrors MAX_MEDIA_PER_REPORT's intent.
export const MAX_PHOTOS_PER_WORK_ORDER = 10;

// Operator attachments are PHOTOS only (the brief is "show the trade the
// problem"); video is the tenant-intake concern, not this one.
export const MAX_WORK_ORDER_PHOTO_BYTES = MAX_IMAGE_BYTES;

/**
 * The object path for a work-order photo inside the shared private incident-media
 * bucket. The FIRST segment MUST be the org id — the bucket's storage RLS gates
 * writes on `(storage.foldername(name))[1]`, so this lands only under the owning
 * org's folder. The `work-orders/<id>` segments group a job's photos; the media
 * id keeps names unique and unguessable.
 */
export function workOrderMediaStoragePath(
  orgId: string,
  workOrderId: string,
  mediaId: string,
  ext: string,
): string {
  return `${orgId}/work-orders/${workOrderId}/${mediaId}.${ext}`;
}
