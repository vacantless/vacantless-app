// Run with: npx tsx scripts/test-confirmation-nudge.ts
//
// Tests the pure pre-showing UNCONFIRMED-nudge decision (S440, Slice 3):
// confirmationNudgeDue (assigned + unconfirmed + open outcome, within the 24h
// lead window, future-only, single-stamp idempotency) + the constants. No I/O.
import { readFileSync } from "node:fs";
import { getNotificationEvent } from "../lib/notifications";
import {
  confirmationListBatches,
  confirmationCountLabel,
  confirmationListLine,
  localDayKey,
  shortViewingAddress,
  type ConfirmationListRow,
  confirmationNudgeDue,
  CONFIRMATION_NUDGE_SENT_COLUMN,
  CONFIRMATION_NUDGE_LEAD_MS,
  HOUR_MS,
} from "../lib/reminders";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const now = 1_000_000_000_000; // fixed "now"
// scheduled time that is `hoursAhead` hours in the future (negative = past)
const ahead = (hoursAhead: number) => now + hoursAhead * HOUR_MS;

const base = {
  nowMs: now,
  assigned: true,
  confirmed: false,
  outcome: null as string | null,
  alreadySent: false,
};

// --- the happy path: assigned, unconfirmed, open, within 3h, in the future ---
ok(
  "in 2h, assigned, unconfirmed → DUE",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2) }) === true,
);
ok(
  'placeholder outcome "scheduled" counts as open → DUE',
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), outcome: "scheduled" }) === true,
);

// --- not assigned → nothing to confirm ---
ok(
  "unassigned → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), assigned: false }) === false,
);

// --- already confirmed → not due ---
ok(
  "confirmed → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), confirmed: true }) === false,
);

// --- a real outcome already recorded (closed) → never nudge ---
ok(
  "cancelled → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), outcome: "cancelled" }) === false,
);
ok(
  "attended → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), outcome: "attended" }) === false,
);
ok(
  "no_show → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), outcome: "no_show" }) === false,
);

// --- single nudge per showing ---
ok(
  "already sent → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(2), alreadySent: true }) === false,
);

// --- timing: future-only, within the lead window ---
ok(
  "start already passed (1h ago) → not due (outcome-nudge territory)",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(-1) }) === false,
);
ok(
  "4h out (> 3h lead) → not due (too early)",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(4) }) === false,
);

// --- inclusive boundaries ---
ok(
  "exactly at lead window (3h out) → DUE (inclusive)",
  confirmationNudgeDue({ ...base, scheduledAtMs: now + CONFIRMATION_NUDGE_LEAD_MS }) === true,
);
ok(
  "1ms past the lead window → not due",
  confirmationNudgeDue({ ...base, scheduledAtMs: now + CONFIRMATION_NUDGE_LEAD_MS + 1 }) === false,
);
ok(
  "right at the start (remaining 0) → DUE (inclusive)",
  confirmationNudgeDue({ ...base, scheduledAtMs: now }) === true,
);

// --- caller can override the window ---
ok(
  "custom lead 48h → a 30h-out showing is due",
  confirmationNudgeDue({ ...base, scheduledAtMs: ahead(30), leadMs: 48 * HOUR_MS }) === true,
);

// --- constants ---
ok("sent column name", CONFIRMATION_NUDGE_SENT_COLUMN === "confirmation_nudge_sent_at");
ok("lead window is 3h (S843a)", CONFIRMATION_NUDGE_LEAD_MS === 3 * HOUR_MS);

// --- S843a: one list per agent per day ---
{
  const tz = "America/Toronto";
  // Thu 2026-11-26 14:15 Toronto (19:15 UTC): the 5:00 pm viewing is 2h45 out.
  const n = Date.UTC(2026, 10, 26, 19, 15);
  const at = (h: number, m: number) => Date.UTC(2026, 10, 26, h + 5, m); // Toronto pm hour -> UTC
  const row = (id: string, ms: number, o: Partial<ConfirmationListRow> = {}): ConfirmationListRow => ({
    id, agentId: "aaliyah", scheduledAtMs: ms, confirmed: false, outcome: "scheduled", alreadySent: false, ...o,
  });
  const block = [
    row("hagar", at(17, 0)),
    row("rukeweh", at(17, 15)),
    row("ada", at(17, 30), { confirmed: true }),
    row("jaider", at(17, 45)),
    row("destiny", at(18, 30)),
    row("venessa", at(18, 45)),
    row("allyson", Date.UTC(2026, 10, 27, 20, 0)), // Fri 3:00 pm: next day
    row("gone", at(17, 20), { outcome: "cancelled" }),
    row("other-agent", at(20, 0), { agentId: "odette" }),
  ];
  const b = confirmationListBatches(block, n, tz);
  ok("one batch for the agent whose first viewing is inside 3h", b.length === 1 && b[0].agentId === "aaliyah");
  ok("the batch lists every unconfirmed viewing that day, earliest first",
    b[0].unconfirmed.join(",") === "hagar,rukeweh,jaider,destiny,venessa");
  ok("confirmed viewings ride along for context", b[0].confirmed.join(",") === "ada");
  ok("tomorrow's viewing is not in today's list", !b[0].unconfirmed.includes("allyson"));
  ok("a cancelled viewing is not listed", !b[0].unconfirmed.includes("gone"));
  ok("day key is the Toronto date", b[0].dayKey === "2026-11-26");
  ok("3h01 before the first viewing: nothing yet",
    confirmationListBatches(block, at(17, 0) - 3 * HOUR_MS - 60_000, tz).length === 0);
  const stamped = block.map((r) => (b[0].unconfirmed.includes(r.id) ? { ...r, alreadySent: true } : r));
  ok("once stamped, the next sweep sends nothing more that day",
    confirmationListBatches(stamped, n + 15 * 60_000, tz).filter((x) => x.agentId === "aaliyah").length === 0);
  const late = [...stamped, row("late", at(19, 15))];
  const lb = confirmationListBatches(late, at(19, 15) - 2 * HOUR_MS, tz).filter((x) => x.agentId === "aaliyah");
  ok("a viewing booked after the list went gets its own, alone",
    lb.length === 1 && lb[0].unconfirmed.join(",") === "late");
  ok("everyone confirmed: no batch",
    confirmationListBatches(block.map((r) => ({ ...r, confirmed: true })), n, tz).length === 0);
  ok("an 11:30 pm viewing stays on its own Toronto day",
    localDayKey(Date.UTC(2026, 10, 27, 4, 30), tz) === "2026-11-26");
  ok("count label plural", confirmationCountLabel(5, 6) === "5 of 6 viewings");
  ok("count label singular", confirmationCountLabel(1, 1) === "1 of 1 viewing");
  ok("short address keeps street and unit",
    shortViewingAddress("1551 Assumption St, Unit 9, Windsor, ON N9A 3E2") === "1551 Assumption St, Unit 9");
  ok("short address falls back", shortViewingAddress(null) === "the property");
  ok("list line with a phone",
    confirmationListLine({ time: "5:00 PM", name: "Hagar", address: "1551 Assumption St, Unit 9, Windsor, ON", contact: "519-555-0100" }) ===
      "5:00 PM  Hagar, 1551 Assumption St, Unit 9 (519-555-0100)");
  ok("list line without a contact",
    confirmationListLine({ time: "5:00 PM", name: null, address: "50 Glenrose Ave", contact: null }) ===
      "5:00 PM  A renter, 50 Glenrose Ave");
}

// --- S843a: the event copy and the route ---
{
  const ev = getNotificationEvent("leasing.showing_unconfirmed_nudge")!;
  ok("subject carries the count and the day", ev.defaultSubject === "{{count_label}} not confirmed yet - {{day_label}}");
  ok("body lists both groups and says what to do",
    ev.defaultBody.includes("{{unconfirmed_list}}") && ev.defaultBody.includes("{{confirmed_list}}") &&
      ev.defaultBody.includes("Text or call them"));
  ok("no em dash in the copy", !/\u2014/.test(ev.defaultSubject + ev.defaultBody + ev.description));
  const route = readFileSync(new URL("../app/api/cron/showing-confirmation-nudge/route.ts", import.meta.url), "utf8");
  ok("route builds per-agent day lists", route.includes("confirmationListBatches("));
  ok("route claims every listed viewing and releases on a failed send",
    route.includes("claimNull(") && route.includes("releaseClaim("));
  ok("route no longer sends one email per viewing", !route.includes("for (const raw of eligibleRows as any[])"));
}

console.log(`\nconfirmation-nudge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
