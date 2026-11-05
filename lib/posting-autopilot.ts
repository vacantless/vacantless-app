// S754 (review item 3): "Post without asking each time" for the free robot
// sites. Pure. The posting worker (app/api/cron/distribution-worker) asks this
// right after it parks a prepared ad at a gate; a yes means the item is
// approved on the spot and the browser robot is woken, so the landlord never
// presses "Approve and post" for a free ad. Money never passes here: a paid ad
// parks at needs_payment and that gate is not in the list.

import { isRobotPostedChannel } from "./posting-lanes";

export type StandingApprovalInput = {
  gate: string;
  channel: string | null | undefined;
  /** organizations.posting_autopilot (migration 0273). */
  autopilot: boolean | null | undefined;
  /** canUseRobotPosting for the run's org (the Posting add-on). */
  addonAllowed: boolean;
};

/** True when the prepared item should be approved without a person. */
export function standingApprovalApplies(input: StandingApprovalInput): boolean {
  if (input.gate !== "needs_operator") return false;
  if (!isRobotPostedChannel(input.channel)) return false;
  if (input.autopilot !== true) return false;
  return input.addonAllowed === true;
}

export const STANDING_APPROVAL_SOURCE = "standing_posting_setting";

/** The audit line written on the item when the standing setting approves it. */
export function standingApprovalAudit(siteLabel: string): string {
  return `Prepared, and posting now on your ${siteLabel} account (your Posting setting: post without asking each time). Press Stop on the rental to hold it.`;
}

/** Copy for the Billing switch. */
export const POSTING_AUTOPILOT_COPY = {
  title: "Post without asking each time",
  on: "On. Each ad goes up on your Kijiji, Rentals.ca and Zumper accounts as soon as it is ready. Paid Kijiji ads still wait for you at checkout.",
  off: "Off. We build each ad and wait for you to press Approve and post on the rental.",
  turnOn: "Turn on",
  turnOff: "Turn off",
} as const;
