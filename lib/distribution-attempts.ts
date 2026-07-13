// ============================================================================
// Pure helpers for the append-only publish ATTEMPT log (S480). No IO — the
// durable table is distribution_publish_attempts (0141). The server actions
// insert an attempt row BEFORE terminal side effects (the S479 reservation model:
// reserve/record first, mutate second, terminal flip last), so run-item history
// and concierge/operator actions are always auditable.
// ============================================================================

import type { PublishMode } from "./distribution-publish";

export const ATTEMPT_ACTOR_TYPES = [
  "system",
  "operator",
  "concierge",
  "browser_copilot",
  "broker",
] as const;
export type AttemptActorType = (typeof ATTEMPT_ACTOR_TYPES)[number];

/** The actor to record for an attempt performed under a given transport. */
export function actorTypeForTransport(transport: PublishMode): AttemptActorType {
  switch (transport) {
    case "concierge":
      return "concierge";
    case "browser_copilot":
      return "browser_copilot";
    case "broker":
      return "broker";
    default:
      return "operator";
  }
}

/** Next attempt number given the run item's current attempt_count. */
export function nextAttemptNo(currentCount: number | null | undefined): number {
  const n = Number(currentCount ?? 0);
  return (Number.isFinite(n) && n > 0 ? n : 0) + 1;
}

export type AttemptRecord = {
  organization_id: string;
  run_id: string;
  run_item_id: string;
  channel: string;
  transport: string | null;
  attempt_no: number;
  actor_type: AttemptActorType;
  actor_user_id: string | null;
  status_before: string | null;
  status_after: string;
  error_code: string | null;
  error_message: string | null;
  proof_id: string | null;
  metadata: Record<string, unknown>;
};

/** Build a normalized attempt row from the loose inputs a server action has. */
export function buildAttemptRecord(input: {
  organizationId: string;
  runId: string;
  runItemId: string;
  channel: string;
  transport?: string | null;
  currentAttemptCount?: number | null;
  actorType: AttemptActorType;
  actorUserId?: string | null;
  statusBefore?: string | null;
  statusAfter: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  proofId?: string | null;
  metadata?: Record<string, unknown>;
}): AttemptRecord {
  return {
    organization_id: input.organizationId,
    run_id: input.runId,
    run_item_id: input.runItemId,
    channel: input.channel,
    transport: input.transport ?? null,
    attempt_no: nextAttemptNo(input.currentAttemptCount),
    actor_type: input.actorType,
    actor_user_id: input.actorUserId ?? null,
    status_before: input.statusBefore ?? null,
    status_after: input.statusAfter,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    proof_id: input.proofId ?? null,
    metadata: input.metadata ?? {},
  };
}
