// account-closure.ts (S702). The pure rules for "Close this account".
//
// The stranger walk found no way for a landlord to leave. Closing is a soft
// close the landlord runs themselves: every rental comes off the market, the
// account's logins are removed, and we are told so the stored data is deleted
// within 30 days (the promise on /data-deletion). Two things block a close,
// because closing would leave something running that the landlord did not
// mean to leave: a live paid plan (they would keep being billed), and
// viewings still booked (renters would turn up to nobody).
//
// Pure + data-shape only so the gate is unit-testable.
import { isSubscriptionActive } from "./billing";

export type AccountClosureInput = {
  /** The caller's role in this org. Only owner_admin may close it. */
  role: string | null;
  orgName: string | null;
  /** What the landlord typed into the confirm box. */
  confirmText: string;
  subscriptionStatus: string | null;
  /** Viewings still booked in the future. */
  upcomingViewings: number;
};

export type AccountClosureBlock =
  | "forbidden"
  | "confirm"
  | "billing"
  | "viewings";

export type AccountClosureDecision =
  | { ok: true }
  | { ok: false; reason: AccountClosureBlock };

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function decideAccountClosure(
  input: AccountClosureInput,
): AccountClosureDecision {
  if (input.role !== "owner_admin") return { ok: false, reason: "forbidden" };
  const name = norm(input.orgName);
  if (!name || norm(input.confirmText) !== name) {
    return { ok: false, reason: "confirm" };
  }
  if (
    isSubscriptionActive(input.subscriptionStatus) ||
    input.subscriptionStatus === "past_due"
  ) {
    return { ok: false, reason: "billing" };
  }
  if (input.upcomingViewings > 0) return { ok: false, reason: "viewings" };
  return { ok: true };
}

/** The settings banner for each outcome, in plain words. */
export const ACCOUNT_CLOSURE_MESSAGES: Record<AccountClosureBlock | "error", string> = {
  forbidden: "Only an owner can close this account.",
  confirm: "Type your business name exactly as it appears to confirm.",
  billing:
    "Your paid plan is still active. Cancel it on the Billing page first, then close the account.",
  viewings:
    "You still have viewings booked. Cancel them on the Viewings page first so renters are not left waiting.",
  error: "Something went wrong and nothing was closed. Please try again.",
};

/** Statuses a rental can be in while renters can still find or book it. */
export const OPEN_RENTAL_STATUSES = ["available", "draft"] as const;
