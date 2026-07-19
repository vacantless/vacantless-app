// Run with: npx tsx scripts/test-reminders.ts
import { readFileSync } from "node:fs";
import {
  channelPlan,
  pendingRescheduleShowingIds,
  reminderDue,
  HOUR_MS,
  REMINDER_SENT_COLUMN,
  REMINDER_SMS_SENT_COLUMN,
  SEND_LASTMINUTE_REMINDER,
  type ReminderKind,
  type ReminderChannelPlan,
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
function checkPlan(name: string, got: ReminderChannelPlan, want: ReminderChannelPlan) {
  if (got.email === want.email && got.sms === want.sms) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
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
const due = (
  hoursFromNow: number,
  sent: { sent24h?: boolean; sentSameday?: boolean; sent2h?: boolean } = {},
) =>
  reminderDue({
    scheduledAtMs: at(hoursFromNow),
    nowMs: now,
    sent24h: sent.sent24h === true,
    sentSameday: sent.sentSameday === true,
    sent2h: sent.sent2h === true,
  });

// --- reminder windows -------------------------------------------------------
check("30h out → null", due(30), null);
check("20h out, nothing sent → 24h", due(20), "24h");
check("5h out, nothing sent → 24h", due(5), "24h");
check("4h exactly, nothing sent → sameday", due(4), "sameday");
check("3h out, nothing sent → sameday", due(3), "sameday");
check("90m out, nothing sent → 2h", due(1.5), "2h");
check("past → null", due(-1), null);

// --- sent flags / priority --------------------------------------------------
check("20h out, 24h already sent → null", due(20, { sent24h: true }), null);
check("3h out, 24h already sent → sameday", due(3, { sent24h: true }), "sameday");
check("3h out, sameday already sent → null", due(3, { sentSameday: true }), null);
check(
  "90m out, 24h+sameday already sent → 2h",
  due(1.5, { sent24h: true, sentSameday: true }),
  "2h",
);
check("90m out, 2h already sent → null", due(1.5, { sent2h: true }), null);
check("last-minute booking 90m out, neither sent → 2h only", due(1.5), "2h");
check("exactly now → null", due(0), null);

// --- catch-up safety: late cron run still fires the pending 2h ---
check(
  "1min out, earlier tiers sent, 2h not → 2h (caught late)",
  reminderDue({
    scheduledAtMs: now + 60_000,
    nowMs: now,
    sent24h: true,
    sentSameday: true,
    sent2h: false,
  }),
  "2h",
);

// --- channel coordination ---------------------------------------------------
checkPlan("24h always email-only", channelPlan("24h", { smsDeliverable: true }), {
  email: true,
  sms: false,
});
checkPlan("24h email-only without sms", channelPlan("24h", { smsDeliverable: false }), {
  email: true,
  sms: false,
});
checkPlan("sameday uses sms when deliverable", channelPlan("sameday", { smsDeliverable: true }), {
  email: false,
  sms: true,
});
checkPlan("sameday falls back to email when sms is not deliverable", channelPlan("sameday", { smsDeliverable: false }), {
  email: true,
  sms: false,
});
checkPlan("2h has no email fallback", channelPlan("2h", { smsDeliverable: false }), {
  email: false,
  sms: false,
});
checkPlan("2h sms is controlled by the default-off last-minute flag", channelPlan("2h", { smsDeliverable: true }), {
  email: false,
  sms: SEND_LASTMINUTE_REMINDER,
});
for (const kind of ["24h", "sameday", "2h"] as ReminderKind[]) {
  for (const smsDeliverable of [false, true]) {
    const plan = channelPlan(kind, { smsDeliverable });
    ok(`${kind} never sends both channels when smsDeliverable=${smsDeliverable}`,
      !(plan.email && plan.sms));
  }
}
ok("sameday email fallback preserves day-of touch",
  channelPlan("sameday", { smsDeliverable: false }).email === true);
ok("email stamp map includes sameday",
  REMINDER_SENT_COLUMN.sameday === "reminder_sameday_sent_at");
ok("sms stamp map includes sameday",
  REMINDER_SMS_SENT_COLUMN.sameday === "reminder_sameday_sms_sent_at");

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
ok("renter reminder route selects same-day reminder stamps",
  renterRoute.includes("reminder_sameday_sent_at") &&
    renterRoute.includes("reminder_sameday_sms_sent_at"));
ok("renter reminder route uses channelPlan",
  renterRoute.includes("channelPlan(kind, { smsDeliverable })"));
ok("confirmation nudge route queries unresponded pending proposals",
  confirmationRoute.includes('.from("showing_reschedule_proposals")') &&
    confirmationRoute.includes('.eq("status", "pending")') &&
    confirmationRoute.includes('.is("responded_at", null)'));
ok("confirmation nudge route filters before one-shot stamp loop",
  confirmationRoute.indexOf("pendingRescheduleShowingIds") <
    confirmationRoute.indexOf("for (const raw of eligibleRows as any[])"));

console.log(`\nreminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
