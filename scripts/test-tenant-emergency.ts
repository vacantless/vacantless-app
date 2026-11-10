// S776 after-hours tenant emergencies (migration 0281). Run: npx tsx scripts/test-tenant-emergency.ts
import { readFileSync } from "node:fs";
import {
  EMERGENCY_KINDS,
  EMERGENCY_CATEGORY,
  EMERGENCY_DO_NOW,
  EMERGENCY_LABELS,
  callNineOneOneFirst,
  emergencyAlertText,
  emergencyEmailSubject,
  emergencyTextTarget,
  parseEmergencyKind,
  reportThanksLine,
  showsEmergencyInfo,
} from "@/lib/tenant-emergency";
import { INCIDENT_CATEGORIES, isMessageCategory, repeatReportLine } from "@/lib/incident-reports";
import { normalizePhoneE164 } from "@/lib/sms";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

ok("parse: blank and unknown are not emergencies", parseEmergencyKind("") === null && parseEmergencyKind(null) === null && parseEmergencyKind("flood") === null);
ok("parse: a kind is kept", parseEmergencyKind(" water_leak ") === "water_leak");
ok("every kind has a label, words and a real category", EMERGENCY_KINDS.every((k) =>
  !!EMERGENCY_LABELS[k] && !!EMERGENCY_DO_NOW[k] && (INCIDENT_CATEGORIES as readonly string[]).includes(EMERGENCY_CATEGORY[k])));
ok("911 first only for gas and fire", callNineOneOneFirst("gas_smell") && callNineOneOneFirst("fire_smoke") && !callNineOneOneFirst("water_leak") && !callNineOneOneFirst(null));
ok("gas words say leave and 911", /Leave/.test(EMERGENCY_DO_NOW.gas_smell) && /911/.test(EMERGENCY_DO_NOW.gas_smell));
ok("shut-off info for water, not for lockout", showsEmergencyInfo("water_leak") && !showsEmergencyInfo("locked_out"));
ok("no em dashes in any words", ![...Object.values(EMERGENCY_LABELS), ...Object.values(EMERGENCY_DO_NOW), reportThanksLine("A", true), reportThanksLine("A", false)].some((s) => /[–—]/.test(s)));
ok("thanks lines differ", reportThanksLine("Lakeview", true).includes("alerted now") && reportThanksLine("Lakeview", false).includes("business hours"));

const own = "+12492099019";
ok("target: emergency phone first", emergencyTextTarget({ emergency_phone: "519-555-0100", showing_arrival_phone: "226-778-0014" }, own, normalizePhoneE164) === "+15195550100");
ok("target: arrival phone next (Agile shape)", emergencyTextTarget({ showing_arrival_phone: "226-778-0014", public_contact_phone: "519-915-8865 ext 103" }, null, normalizePhoneE164) === "+12267780014");
ok("target: a number with an extension is skipped", emergencyTextTarget({ public_contact_phone: "519-915-8865 ext 103" }, null, normalizePhoneE164) === null);
ok("target: never the account's own texting number", emergencyTextTarget({ emergency_phone: "249-209-9019", public_contact_phone: "519-555-0142" }, own, normalizePhoneE164) === "+15195550142");
ok("target: the rental's phone beats the account's (S776b)", emergencyTextTarget({ rental_emergency_phone: "519-555-0177", emergency_phone: "519-555-0100" }, own, normalizePhoneE164) === "+15195550177");
ok("target: a rental phone with an extension falls back", emergencyTextTarget({ rental_emergency_phone: "519-555-0177 ext 2", emergency_phone: "519-555-0100" }, own, normalizePhoneE164) === "+15195550100");
ok("target: nothing set = no text", emergencyTextTarget({}, null, normalizePhoneE164) === null);

const t = emergencyAlertText({ kind: "water_leak", address: "100 Lakeview Ave", reporterName: "Sam", reporterContact: "519-555-0199", inboxUrl: "https://app.vacantless.com/dashboard/maintenance#reports" });
ok("alert text names kind, place, who and link", t.startsWith("Emergency at 100 Lakeview Ave: Water leaking now.") && t.includes("Sam just reported it, reach them at 519-555-0199") && t.endsWith("#reports"), t);
ok("alert text under two segments", t.length <= 300, t.length);
ok("email subject", emergencyEmailSubject("no_heat", "100 Lakeview Ave") === "Emergency: No heat - 100 Lakeview Ave");

const mig = readFileSync("supabase/migrations/0281_tenant_emergencies.sql", "utf8");
const m83 = readFileSync("supabase/migrations/0283_request_categories.sql", "utf8");
const kindsSql = EMERGENCY_KINDS.map((k) => `'${k}'`).join(",");
ok("0283 lists the same kinds twice (check + submit)", (m83.split(kindsSql).length - 1) === 2);
const catsSql = INCIDENT_CATEGORIES.slice().sort().join("|");
const sqlCats = (m83.match(/category in \(([^)]*)\)/) || ["", ""])[1].replace(/'/g, "").split(",").sort().join("|");
ok("0283 incident categories match lib", sqlCats === catsSql, sqlCats);
ok("0283 approve refuses messages", m83.includes("if v_report.category in ('noise','not_repair') then") && m83.includes("'reason', 'message'"));
ok("door emergency files under doors and locks", EMERGENCY_CATEGORY.door_unsecured === "doors_locks" && EMERGENCY_LABELS.door_unsecured === "Front door won't lock or close");
ok("repeat line", repeatReportLine(0, "Plumbing") === null && repeatReportLine(2, "Plumbing") === "3rd plumbing report from this unit in 90 days");
ok("messages", isMessageCategory("noise") && isMessageCategory("not_repair") && !isMessageCategory("parking"));
ok("0281 drops the 6-arg submit and grants the 7-arg one", mig.includes("drop function if exists public.submit_incident_report(text, text, text, text, text, boolean);") && mig.includes("submit_incident_report(text, text, text, text, text, boolean, text)\n  to anon, authenticated"));
ok("0281 approve makes emergencies urgent", mig.includes("when v_report.emergency_kind is not null then 'urgent'"));
ok("0281 context returns info and call phone", mig.includes("'emergency_info',") && mig.includes("'emergency_call_phone'"));

const action = readFileSync("app/report/[token]/actions.ts", "utf8");
ok("action passes the kind and texts on emergency", action.includes("p_emergency_kind: emergencyKind") && action.includes("textEmergency(admin, org, emergencyKind, r)"));
const form = readFileSync("app/report/[token]/report-form.tsx", "utf8");
ok("form asks first and sends the kind", form.includes("Is this an emergency?") && form.includes("emergencyKind: emergency") && form.includes('href="tel:911"'));
const page = readFileSync("app/report/[token]/page.tsx", "utf8");
ok("thanks page has no em dash", !/—/.test(page));
const maint = readFileSync("app/dashboard/maintenance/page.tsx", "utf8");
ok("inbox shows the chip and emergency phone form", maint.includes("Emergency: {emergencyLabel(r.emergency_kind)}") && maint.includes('name="emergency_phone"'));
const rental = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
const pactions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("rental has the emergency info field", rental.includes('name="emergency_info"') && rental.includes("showing_arrival_phone, emergency_info,") && pactions.includes('formData.has("emergency_info")'));

const m2 = readFileSync("supabase/migrations/0282_rental_emergency_phone.sql", "utf8");
ok("0282 adds the rental phone and puts it first for the tenant", m2.includes("add column if not exists emergency_phone text") && m2.includes("coalesce(v_prop_phone,"));
ok("rental form and action carry the phone, text uses it", rental.includes('name="emergency_phone"') && rental.includes("emergency_info, emergency_phone, viewing_earliest_date") && pactions.includes('formData.has("emergency_phone")') && action.includes("rental_emergency_phone: r.property?.emergency_phone"));
console.log(`tenant-emergency: ${p} passed, ${f} failed`);
if (f) process.exit(1);
