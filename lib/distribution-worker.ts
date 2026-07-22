// ============================================================================
// Pure helpers for the done-for-you posting WORKER (S553 Slice 1). No DOM / env
// / IO here so it unit-tests cleanly via scripts/test-distribution-worker.ts.
// The impure pieces (the Anthropic compose call, the DB claim/gate writes, the
// notification) live in lib/distribution-worker-ai.ts + the cron route and use
// THIS module to decide eligibility, the gate to stop at, and the agent prompt.
//
// The worker's job in this slice: take a FRESH authorized concierge job and
// PREPARE it, then stop at the first human gate. It never logs in, enters a
// password or card, solves a CAPTCHA, clicks final submit, or sets live/
// submitted. Every allowed output is one of three gate states; the guard below
// exists so a regression that tried to emit a terminal state fails loudly.
// ============================================================================

import type { PublishMode, PublishStatus } from "./distribution-publish";
import type { RunStep } from "./distribution-run";

// --- eligibility -----------------------------------------------------------
// A concierge job is worker-eligible ONLY when it is FRESH — publish_status
// "queued", the exact state requestConciergePublish leaves a requested item in
// (mode "concierge", publish_status "queued", concierge_claimed_by null). The
// gate states (needs_*) are intentionally EXCLUDED from eligibility: once the
// worker has moved a job to a gate it is waiting on a human, and re-preparing it
// would loop and re-notify. So the entry point is queued and only queued.
export const WORKER_ELIGIBLE_STATUSES: readonly PublishStatus[] = ["queued"];

// The only publish_status values the worker may WRITE. Never live/submitted/
// skipped/rejected — those are reached by a human (completeConciergeItem etc.).
export const WORKER_GATE_STATUSES = [
  "needs_login",
  "needs_payment",
  "needs_operator",
] as const;
export type WorkerGate = (typeof WORKER_GATE_STATUSES)[number];

export function isWorkerGate(value: unknown): value is WorkerGate {
  return (
    typeof value === "string" &&
    (WORKER_GATE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Can the worker pick up this run item? Pure. True only for a concierge-mode,
 * org-and-channel-authorized, unclaimed, queued item. Anything else (wrong mode,
 * unauthorized channel, already claimed, or any non-queued status) is false, so
 * the worker never touches an automatic channel, a human-claimed item, or a job
 * already sitting at a gate.
 */
export function workerJobEligible(input: {
  mode: PublishMode;
  publishStatus: PublishStatus;
  automationAuthorized: boolean;
  claimedBy: string | null;
}): boolean {
  return (
    input.mode === "concierge" &&
    input.automationAuthorized === true &&
    input.claimedBy == null &&
    WORKER_ELIGIBLE_STATUSES.includes(input.publishStatus)
  );
}

// --- gate selection --------------------------------------------------------
/**
 * Which human gate should a prepared job stop at? Precedence, highest first:
 *   1. needs_login  — the channel requires a login/CAPTCHA and is not connected;
 *                     a human must log in. The worker never logs in.
 *   2. needs_payment — the channel is a paid listing and payment is not cleared;
 *                     a human must pay. The worker never enters card details.
 *   3. needs_operator — prepared and ready for a human to review + final submit.
 * The worker NEVER returns a live/submitted state — final submit is a human gate.
 */
export function selectGate(input: {
  requiresLogin: boolean;
  connected: boolean;
  channelRequiresPayment: boolean;
  paymentCleared: boolean;
}): WorkerGate {
  if (input.requiresLogin && !input.connected) return "needs_login";
  if (input.channelRequiresPayment && !input.paymentCleared) return "needs_payment";
  return "needs_operator";
}

/**
 * Belt-and-suspenders guard the cron calls before writing publish_status: the
 * worker must never persist a terminal/live state. Throws if a caller ever tries
 * to advance a job past a gate. (The cron only ever passes selectGate()'s output,
 * so in normal operation this never fires; it exists to catch a future edit.)
 */
export function assertWorkerNeverTerminal(status: string): void {
  const forbidden = ["live", "submitted", "skipped", "rejected"];
  if (forbidden.includes(status)) {
    throw new Error(
      `distribution worker must never write a terminal publish_status: ${status}`,
    );
  }
}

// --- agent compose prompt --------------------------------------------------
// The listing facts the compose prompt is built from. Loose + nullable — the
// worker passes whatever the property row has; missing fields are simply omitted
// from the prompt (never guessed).
export type WorkerListingFacts = {
  propertyAddress: string | null;
  beds: number | null;
  baths: number | null;
  rentCents: number | null;
  unitType: string | null;
  description: string | null;
};

export type AgentComposePrompt = { system: string; user: string };

/**
 * Build the compose prompt for the posting worker. PURE — no env, no secrets, no
 * network. The agent's ONLY job here is to COMPOSE: normalize the listing copy
 * for the channel and emit a short human checklist of what remains at the gate.
 * The system line forbids auto-submit/publish, mirroring the existing auto
 * listing copy adapter. It never asks the model to log in, pay, or submit.
 */
export function buildAgentComposePrompt(input: {
  channelKey: string;
  channelLabel: string;
  listing: WorkerListingFacts;
  steps: RunStep[];
}): AgentComposePrompt {
  const facts: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    facts.push(`${label}: ${String(value)}`);
  };
  add("Property", input.listing.propertyAddress);
  add("Unit type", input.listing.unitType);
  add("Bedrooms", input.listing.beds);
  add("Bathrooms", input.listing.baths);
  if (
    typeof input.listing.rentCents === "number" &&
    Number.isFinite(input.listing.rentCents) &&
    input.listing.rentCents > 0
  ) {
    add("Monthly rent", `$${Math.round(input.listing.rentCents / 100)} per month`);
  }
  add("Existing description", input.listing.description);

  const stepLines = input.steps.map((s, i) => `${i + 1}. ${s.label}`);

  const user = [
    `Prepare a rental listing post for the ${input.channelLabel} channel from ONLY the facts below.`,
    "Do not add or imply any feature, amenity, price, policy, or claim that is not supplied.",
    "Do not target or exclude people. Describe the unit, not the renter.",
    "No links. No em dashes. Plain text only.",
    "Return: (a) a channel-ready title, (b) a two or three paragraph description, and",
    "(c) a short checklist of what a human still has to do to post it (log in if needed, pay if needed, review, and click submit).",
    "",
    "Facts:",
    facts.length > 0 ? facts.join("\n") : "No structured facts supplied.",
    "",
    "The channel's posting steps (for the human checklist):",
    stepLines.length > 0 ? stepLines.join("\n") : "No steps supplied.",
  ].join("\n");

  return {
    system:
      "You prepare honest rental listing copy for a human to review and post. " +
      "You never invent facts. You never log in, pay, solve a CAPTCHA, submit, or " +
      "publish anything. Your output is a draft plus a checklist for a person.",
    user,
  };
}
