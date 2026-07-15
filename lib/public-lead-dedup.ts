export const PUBLIC_LEAD_DEDUP_WINDOW_MINUTES = 10;
export const PUBLIC_LEAD_DEDUP_WINDOW_MS =
  PUBLIC_LEAD_DEDUP_WINDOW_MINUTES * 60 * 1000;

export const PUBLIC_LEAD_DEDUP_OPEN_STATUSES = [
  "new",
  "replied",
  "contacted",
  "booked",
] as const;

export type PublicLeadDedupStatus =
  (typeof PUBLIC_LEAD_DEDUP_OPEN_STATUSES)[number];

export type PublicLeadDedupCandidate = {
  id: string;
  organizationId: string;
  propertyId: string | null;
  email: string | null;
  status: string | null;
  createdAt: string | Date;
};

export type PublicLeadSubmitEffects = {
  attemptBooking: boolean;
  notifyNewLead: boolean;
  sendAutoReply: boolean;
};

export function normalizePublicLeadDedupEmail(
  email: string | null | undefined,
): string | null {
  const normalized = email?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function isPublicLeadDedupStatus(
  status: string | null | undefined,
): status is PublicLeadDedupStatus {
  return PUBLIC_LEAD_DEDUP_OPEN_STATUSES.includes(
    status as PublicLeadDedupStatus,
  );
}

export function findReusablePublicLead(
  candidates: PublicLeadDedupCandidate[],
  input: {
    organizationId: string;
    propertyId: string;
    email: string | null | undefined;
    now?: string | Date;
  },
): PublicLeadDedupCandidate | null {
  const email = normalizePublicLeadDedupEmail(input.email);
  if (!email) return null;

  const nowMs = input.now ? new Date(input.now).getTime() : Date.now();
  const cutoffMs = nowMs - PUBLIC_LEAD_DEDUP_WINDOW_MS;

  return (
    candidates
      .filter((candidate) => {
        if (candidate.organizationId !== input.organizationId) return false;
        if (candidate.propertyId !== input.propertyId) return false;
        if (!isPublicLeadDedupStatus(candidate.status)) return false;
        if (normalizePublicLeadDedupEmail(candidate.email) !== email) return false;
        const createdMs = new Date(candidate.createdAt).getTime();
        return Number.isFinite(createdMs) && createdMs >= cutoffMs;
      })
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0] ?? null
  );
}

export function publicLeadSubmitEffects(input: {
  leadReused: boolean;
  leadHasShowing?: boolean;
  hasSlot: boolean;
  outcome: "submitted" | "booked" | "booking_failed";
}): PublicLeadSubmitEffects {
  return {
    attemptBooking:
      input.hasSlot && !(input.leadReused && input.leadHasShowing === true),
    notifyNewLead: !input.leadReused,
    sendAutoReply: !input.leadReused && input.outcome !== "booked",
  };
}
