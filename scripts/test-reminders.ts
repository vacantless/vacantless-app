// Run with: npx tsx scripts/test-reminders.ts
import { reminderDue, HOUR_MS, type ReminderKind } from "../lib/reminders";

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

console.log(`\nreminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
