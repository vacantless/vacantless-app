// dashboard-today.ts — the "Today" action lane (Codex design audit #3, S377).
//
// The Overview page led with stat cards (Open inquiries / New this week /
// Rentals) — vanity-ish numbers — before anything the operator can ACT on.
// Codex's audit asked for an action-first lane above the stats. This pure
// helper turns the counts the page already derives into an ordered list of
// "do this now" items, surfacing ONLY what is actionable (the conditional-
// visibility rule used elsewhere on this page: rent-increase rollup, tenant
// messages, maintenance). When nothing is actionable the list is empty and the
// page shows a calm "all caught up" state.
//
// Pure + data-shape only (no DB, no JSX) so it is unit-testable and the lane
// can never disagree with the numbers feeding it.

export type TodayTone = "urgent" | "action";

export type TodayItem = {
  /** Stable key for React + tests. */
  key: string;
  /** Headline, already pluralized (e.g. "3 inquiries need a reply"). */
  label: string;
  /** One short supporting line. */
  detail: string;
  /** Where the CTA goes. */
  href: string;
  tone: TodayTone;
};

export type TodayInput = {
  /** Leads whose status means the operator still owes a reply. */
  inquiriesNeedingReply: number;
  /** Viewings scheduled for today (operator timezone). */
  viewingsToday: number;
  /** Tenant-message drafts pending approval (approve-to-send drip). */
  messagesAwaitingApproval: number;
  /**
   * Rent increases past their serve-by or eligible date (overdue + serve_late);
   * the time-critical ones only — in-window ones are not "today" pressing.
   */
  rentIncreasesOverdue: number;
  /** Open work orders flagged urgent. */
  urgentWorkOrders: number;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Ordered most-time-critical first. Each entry is included only when its count
// is > 0, so the lane is exactly the set of things needing action right now.
export function buildTodayLane(input: TodayInput): TodayItem[] {
  const items: TodayItem[] = [];

  if (input.inquiriesNeedingReply > 0) {
    items.push({
      key: "inquiries",
      label: `${plural(input.inquiriesNeedingReply, "inquiry needs", "inquiries need")} a reply`,
      detail: "Renters waiting to hear back. Fast replies book more viewings.",
      href: "/dashboard/leads",
      tone: "urgent",
    });
  }

  if (input.viewingsToday > 0) {
    items.push({
      key: "viewings",
      label: `${plural(input.viewingsToday, "viewing", "viewings")} today`,
      detail: "Scheduled to happen today. Confirm you (or your agent) can cover them.",
      href: "/dashboard/showings",
      tone: "action",
    });
  }

  if (input.messagesAwaitingApproval > 0) {
    items.push({
      key: "messages",
      label: `${plural(input.messagesAwaitingApproval, "tenant message", "tenant messages")} to approve`,
      detail: "Drafted for your tenants. Nothing sends until you approve it.",
      href: "/dashboard/messages",
      tone: "action",
    });
  }

  if (input.rentIncreasesOverdue > 0) {
    items.push({
      key: "rent-increases",
      label: `${plural(input.rentIncreasesOverdue, "rent increase is", "rent increases are")} past due to serve`,
      detail: "Serve the notice to keep the increase on schedule.",
      href: "/dashboard/tenancies",
      tone: "urgent",
    });
  }

  if (input.urgentWorkOrders > 0) {
    items.push({
      key: "work-orders",
      label: `${plural(input.urgentWorkOrders, "urgent repair", "urgent repairs")} open`,
      detail: "Flagged urgent and still in progress. Assign a trade and track it.",
      href: "/dashboard/maintenance",
      tone: "urgent",
    });
  }

  return items;
}
