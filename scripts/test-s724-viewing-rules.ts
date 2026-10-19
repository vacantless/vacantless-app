// S724 (V251-24): viewing rules per rental. Run: npx tsx scripts/test-s724-viewing-rules.ts
import { readFileSync } from "node:fs";
import { generateSlots, type Availability } from "../lib/booking";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }
const now = new Date("2026-10-19T14:00:00Z"); // Mon 10:00 Toronto
const base: Availability = {
  timezone: "America/Toronto", slot_minutes: 30, lead_hours: 12, horizon_days: 14,
  rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_minute: 17 * 60, end_minute: 18 * 60 })),
  booked: [],
};
const all = generateSlots(base, now);
ok("no limit: starts this week", all[0]?.dayKey === "2026-10-19" || all[0]?.dayKey === "2026-10-20", all[0]?.dayKey);
const later = generateSlots({ ...base, earliest_date: "2026-10-26" }, now);
ok("earliest date respected", later.length > 0 && later.every((d) => d.dayKey >= "2026-10-26"), later.map((d) => d.dayKey));
ok("earliest date drops a week", later.length === all.length - all.filter((d) => d.dayKey < "2026-10-26").length);
const notice = generateSlots({ ...base, lead_hours: 24 }, now);
ok("24h notice drops today and tomorrow-early", notice[0]?.dayKey === "2026-10-20", notice[0]?.dayKey);

const mig = readFileSync("supabase/migrations/0252_per_rental_viewing_rules.sql", "utf8");
ok("rpc uses the rental's notice", /coalesce\(p\.viewing_lead_hours, o\.booking_lead_hours\)/.test(mig));
ok("booking re-checks", /S724: per-rental viewing rules/.test(mig) && /viewing_earliest_date/.test(mig));
ok("confirm flag per rental", /coalesce\(p\.viewing_requires_confirmation, o\.booking_requires_confirmation\)/.test(mig));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("save writes the three fields", /viewing_earliest_date: parseDateOrNull/.test(actions) && /viewing_lead_hours: parseViewingLeadHours/.test(actions) && /viewing_requires_confirmation: parseTriBool/.test(actions));
ok("save only when the block is on the page", /formData\.has\("viewing_rules_present"\)/.test(actions));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("form fields", /name="viewing_earliest_date"/.test(page) && /name="viewing_lead_hours"/.test(page) && /name="viewing_requires_confirmation"/.test(page));
console.log(`s724-viewing-rules: ${p} passed, ${f} failed`);
if (f) process.exit(1);
