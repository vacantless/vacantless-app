import { isValidSlot, type Availability } from "./booking";

export const MAX_PROPOSED_RESCHEDULE_SLOTS = 3;
export const RESCHEDULE_PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "expired",
] as const;
export type RescheduleProposalStatus =
  (typeof RESCHEDULE_PROPOSAL_STATUSES)[number];

export type RescheduleAcceptCheck =
  | { ok: true; slot: string }
  | {
      ok: false;
      reason: "not_pending" | "slot_not_proposed" | "slot_not_available";
    };

export function isRescheduleProposalStatus(
  value: unknown,
): value is RescheduleProposalStatus {
  return (
    typeof value === "string" &&
    (RESCHEDULE_PROPOSAL_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeProposedSlots(
  values: Iterable<unknown>,
  max = MAX_PROPOSED_RESCHEDULE_SLOTS,
): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const raw of values) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const ms = new Date(text).getTime();
    if (Number.isNaN(ms) || seen.has(ms)) continue;
    seen.add(ms);
    out.push(new Date(ms).toISOString());
    if (out.length >= max) break;
  }
  return out;
}

export function proposedSlotMatches(
  proposedSlots: readonly string[],
  slot: string,
): boolean {
  const target = new Date(slot).getTime();
  if (Number.isNaN(target)) return false;
  return proposedSlots.some((candidate) => {
    const ms = new Date(candidate).getTime();
    return !Number.isNaN(ms) && ms === target;
  });
}

export function canAcceptRescheduleProposal(input: {
  status: RescheduleProposalStatus;
  proposedSlots: readonly string[];
  slot: string;
  availability: Availability;
  now?: Date;
  excludeShowingId?: string | null;
}): RescheduleAcceptCheck {
  if (input.status !== "pending") return { ok: false, reason: "not_pending" };
  if (!proposedSlotMatches(input.proposedSlots, input.slot)) {
    return { ok: false, reason: "slot_not_proposed" };
  }
  if (
    !isValidSlot(input.availability, input.slot, input.now ?? new Date(), {
      excludeShowingId: input.excludeShowingId,
    })
  ) {
    return { ok: false, reason: "slot_not_available" };
  }
  return { ok: true, slot: new Date(input.slot).toISOString() };
}
