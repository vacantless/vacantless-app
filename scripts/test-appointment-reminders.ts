// Run with: npx tsx scripts/test-appointment-reminders.ts
//
// Tests the pure repair-appointment reminder decision (S387, Slice 4):
// appointmentReminderDue (1-day + same-day, calendar-day based, catch-up safe)
// + isoDaysBetween + the per-channel stamp-column maps + the SMS copy. No I/O.
import {
  appointmentReminderDue,
  isoDaysBetween,
  APPOINTMENT_REMINDER_SENT_COLUMN,
  APPOINTMENT_REMINDER_SMS_SENT_COLUMN,
  HOUR_MS,
  type ApptReminderKind,
} from "../lib/reminders";
import { repairReminderSms, smsSegments } from "../lib/sms";

let pass = 0;
let fail = 0;
function check(name: string, got: ApptReminderKind | null, want: ApptReminderKind | null) {
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

// --- same-day (appointment date is today, 0 days away) ---
check(
  "today, 4h out, neither sent → sameday",
  appointmentReminderDue({ apptStartMs: at(4), nowMs: now, daysUntilAppt: 0, sent1d: false, sentSameday: false }),
  "sameday",
);
check(
  "today, 4h out, sameday already sent → null",
  appointmentReminderDue({ apptStartMs: at(4), nowMs: now, daysUntilAppt: 0, sent1d: false, sentSameday: true }),
  null,
);
check(
  "today but window already started → null (no late reminder)",
  appointmentReminderDue({ apptStartMs: at(-1), nowMs: now, daysUntilAppt: 0, sent1d: false, sentSameday: false }),
  null,
);
check(
  "today, 1d missed yesterday, only sameday now → sameday (catch-up)",
  appointmentReminderDue({ apptStartMs: at(6), nowMs: now, daysUntilAppt: 0, sent1d: false, sentSameday: false }),
  "sameday",
);

// --- 1-day (appointment date is tomorrow, 1 day away) ---
check(
  "tomorrow, 20h out, neither sent → 1d",
  appointmentReminderDue({ apptStartMs: at(20), nowMs: now, daysUntilAppt: 1, sent1d: false, sentSameday: false }),
  "1d",
);
check(
  "tomorrow, 1d already sent → null",
  appointmentReminderDue({ apptStartMs: at(20), nowMs: now, daysUntilAppt: 1, sent1d: true, sentSameday: false }),
  null,
);

// --- too early / past ---
check(
  "2 days out → null (too early)",
  appointmentReminderDue({ apptStartMs: at(50), nowMs: now, daysUntilAppt: 2, sent1d: false, sentSameday: false }),
  null,
);
check(
  "date already passed (-1) → null",
  appointmentReminderDue({ apptStartMs: at(-30), nowMs: now, daysUntilAppt: -1, sent1d: false, sentSameday: false }),
  null,
);

// --- independence of the two channel stamps ---
// (the cron decides email + SMS separately, each off its own stamp pair)
check(
  "today, email stamp set but sms not → sameday still due on the sms track",
  appointmentReminderDue({ apptStartMs: at(5), nowMs: now, daysUntilAppt: 0, sent1d: false, sentSameday: false }),
  "sameday",
);

// --- isoDaysBetween ---
ok("isoDaysBetween same day = 0", isoDaysBetween("2026-07-01", "2026-07-01") === 0);
ok("isoDaysBetween tomorrow = 1", isoDaysBetween("2026-07-01", "2026-07-02") === 1);
ok("isoDaysBetween yesterday = -1", isoDaysBetween("2026-07-02", "2026-07-01") === -1);
ok("isoDaysBetween across month = 2", isoDaysBetween("2026-07-30", "2026-08-01") === 2);
ok("isoDaysBetween across DST (Mar) = 1", isoDaysBetween("2026-03-08", "2026-03-09") === 1);
ok("isoDaysBetween bad date = null", isoDaysBetween("2026-13-01", "2026-07-01") === null);
ok("isoDaysBetween garbage = null", isoDaysBetween("nope", "2026-07-01") === null);

// --- stamp-column maps line up with the 0095 columns ---
ok("email column 1d", APPOINTMENT_REMINDER_SENT_COLUMN["1d"] === "reminder_1d_sent_at");
ok("email column sameday", APPOINTMENT_REMINDER_SENT_COLUMN.sameday === "reminder_sameday_sent_at");
ok("sms column 1d", APPOINTMENT_REMINDER_SMS_SENT_COLUMN["1d"] === "reminder_1d_sms_sent_at");
ok("sms column sameday", APPOINTMENT_REMINDER_SMS_SENT_COLUMN.sameday === "reminder_sameday_sms_sent_at");
ok(
  "email + sms columns are distinct per kind",
  APPOINTMENT_REMINDER_SENT_COLUMN["1d"] !== APPOINTMENT_REMINDER_SMS_SENT_COLUMN["1d"] &&
    APPOINTMENT_REMINDER_SENT_COLUMN.sameday !== APPOINTMENT_REMINDER_SMS_SENT_COLUMN.sameday,
);

// --- SMS copy (no em dash, opt-out line, sane segment budget) ---
const copyInput = { org_name: "North Star Rentals", property_address: "18 Shorncliffe Rd", when_label: "Jul 1: 8:00 AM - 12:00 PM" };
const sms1d = repairReminderSms(copyInput, "1d");
const smsSame = repairReminderSms(copyInput, "sameday");
ok("sms 1d mentions tomorrow", /tomorrow/i.test(sms1d));
ok("sms sameday mentions today", /today/i.test(smsSame));
ok("sms 1d has STOP opt-out", /Reply STOP to opt out\./.test(sms1d));
ok("sms includes the arrival window", sms1d.includes("Jul 1: 8:00 AM - 12:00 PM"));
ok("sms has no em dash", !/[‒–—―]/.test(sms1d) && !/[‒–—―]/.test(smsSame));
ok("sms within 2 segments", smsSegments(sms1d) <= 2 && smsSegments(smsSame) <= 2);
// graceful fallbacks when org/address missing
const smsBare = repairReminderSms({ org_name: null, property_address: null, when_label: "today" }, "sameday");
ok("sms bare falls back to generic org + unit", smsBare.includes("Your property team") && smsBare.includes("your unit"));

console.log(`\nappointment-reminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
