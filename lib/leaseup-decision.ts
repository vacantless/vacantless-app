export type LeaseupDecisionAction =
  | "skip_paid"
  | "steer_to_pool"
  | "repoint_to_waitlist"
  | "takedown";

export type LeaseupDecisionInput = {
  propertyStatus: "leased";
  channel: string;
  isPaid: boolean;
  siblingAvailableCount: number;
  waitlistEnabled: boolean;
};

export type LeaseupDecision = {
  action: LeaseupDecisionAction;
  reason: string;
};

export function decideLeaseupAdLifecycle(
  input: LeaseupDecisionInput,
): LeaseupDecision {
  const channel = input.channel.trim() || "unknown";
  if (input.isPaid) {
    return {
      action: "skip_paid",
      reason: `${channel}: paid placement stays up until it expires`,
    };
  }

  if (input.siblingAvailableCount > 0) {
    return {
      action: "steer_to_pool",
      reason: `${channel}: ${input.siblingAvailableCount} compatible available sibling unit(s) can catch demand`,
    };
  }

  if (input.waitlistEnabled) {
    return {
      action: "repoint_to_waitlist",
      reason: `${channel}: no compatible sibling; keep the tracked link as waiting-list capture`,
    };
  }

  return {
    action: "takedown",
    reason: `${channel}: no compatible sibling and waitlist is off`,
  };
}
