// Run with: npx tsx scripts/test-reminders.ts
import { readFileSync } from "node:fs";
import {
  pendingRescheduleShowingIds,
  reminderDue,
  HOUR_MS,
  type ReminderKind,
} from "../lib/reminders";

let pass = 0;
let fail = 0;
function check(name: string, got: ReminderKind | null, want: ReminderKind | null) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name} — got ${got}, want ${want}`);
  }
}
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const now = 1_000_000_000_000; // arbitrary fixed "now"
const at = (hoursFromNow: number) => now + hoursFromNow * HOUR_MS;

// --- 24h window (2h < msUntil <= 24h) ---
check("23h out, nothing sent → 24h", reminderDue({ scheduledAtMs: at(23), nowMs: now, sent24h: false, sent2h: false }), "24h");
check("24h exactly, nothing sent → 24h", reminderDue({ scheduledAtMs: at(24), nowMs: now, sent24h: false, sent2h: false }), "24h");
check("23h out, 24h already sent → null", reminderDue({ scheduledAtMs: at(23), nowMs: now, sent24h: true, sent2h: false }), null);
check("3h out, nothing sent → 24h", reminderDue({ scheduledAtMs: at(3), nowMs: now, sent24h: false, sent2h: false }), "24h");

// --- too early (> 24h) ---
check("25h out → null", reminderDue({ scheduledAtMs: at(25), nowMs: now, sent24h: false, sent2h: false }), null);
check("48h out → null", reminderDue({ scheduledAtMs: at(48), nowMs: now, sent24h: false, sent2h: false }), null);

// --- 2h window (0 < msUntil <= 2h) ---
check("2h exactly, nothing sent → 2h", reminderDue({ scheduledAtMs: at(2), nowMs: now, sent24h: false, sent2h: false }), "2h");
check("1.5h out, 24h already sent → 2h", reminderDue({ scheduledAtMs: at(1.5), nowMs: now, sent24h: true, sent2h: false }), "2h");
check("1h out, 2h already sent → null", reminderDue({ scheduledAtMs: at(1), nowMs: now, sent24h: true, sent2h: true }), null);
check("last-minute booking 1h out, neither sent → 2h (no spurious 24h)", reminderDue({ scheduledAtMs: at(1), nowMs: now, sent24h: false, sent2h: false }), "2h");

// --- past / boundary ---
check("exactly now → null", reminderDue({ scheduledAtMs: at(0), nowMs: now, sent24h: false, sent2h: false }), null);
check("1h in the past → null", reminderDue({ scheduledAtMs: at(-1), nowMs: now, sent24h: false, sent2h: false }), null);

// --- catch-up safety: late cron run still fires the pending 2h ---
check("1min out, 24h sent, 2h not → 2h (caught late)", reminderDue({ scheduledAtMs: now + 60_000, nowMs: now, sent24h: true, sent2h: false }), "2h");

// --- reschedule suppression (S502) -----------------------------------------
const pendingIds = pendingRescheduleShowingIds([
  { showing_id: "showing-mid", status: "pending", responded_at: null },
  { showing_id: "showing-responded", status: "pending", responded_at: "2026-07-16T15:00:00.000Z" },
  { showing_id: "showing-expired", status: "expired", responded_at: null },
]);
const candidates = [
  {
    id: "showing-mid",
    reminder_24h_sent_at: null,
    reminder_2h_sent_at: null,
    confirmation_nudge_sent_at: null,
  },
  {
    id: "showing-responded",
    reminder_24h_sent_at: null,
    reminder_2h_sent_at: null,
    confirmation_nudge_sent_at: null,
  },
];
const eligible = candidates.filter((row) => !pendingIds.has(row.id));
ok("unresponded pending proposal marks showing mid-reschedule",
  pendingIds.has("showing-mid"));
ok("responded or expired proposal does not suppress reminders",
  !pendingIds.has("showing-responded") && !pendingIds.has("showing-expired"));
ok("mid-reschedule showing is removed before reminder/nudge work",
  eligible.map((row) => row.id).join(",") === "showing-responded");
ok("suppressed showing keeps reminder/nudge stamps null",
  candidates[0].reminder_24h_sent_at === null &&
    candidates[0].reminder_2h_sent_at === null &&
    candidates[0].confirmation_nudge_sent_at === null);

const renterRoute = readFileSync(
  new URL("../app/api/cron/reminders/route.ts", import.meta.url),
  "utf8",
);
const confirmationRoute = readFileSync(
  new URL("../app/api/cron/showing-confirmation-nudge/route.ts", import.meta.url),
  "utf8",
);
ok("renter reminder route queries unresponded pending proposals",
  renterRoute.includes('.from("showing_reschedule_proposals")') &&
    renterRoute.includes('.eq("status", "pending")') &&
    renterRoute.includes('.is("responded_at", null)'));
ok("renter reminder route filters before send/stamp loop",
  renterRoute.indexOf("pendingRescheduleShowingIds") <
    renterRoute.indexOf("for (const row of rows as any[])"));
ok("confirmation nudge route queries unresponded pending proposals",
  confirmationRoute.includes('.from("showing_reschedule_proposals")') &&
    confirmationRoute.includes('.eq("status", "pending")') &&
    confirmationRoute.includes('.is("responded_at", null)'));
ok("confirmation nudge route filters before one-shot stamp loop",
  confirmationRoute.indexOf("pendingRescheduleShowingIds") <
    confirmationRoute.indexOf("for (const raw of eligibleRows as any[])"));

console.log(`\nreminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
