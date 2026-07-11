// scripts/test-waitlist.ts — unit tests for lib/waitlist (S457).
// Run: npx tsx scripts/test-waitlist.ts
import {
  isWaitlistStatus,
  waitlistStatusLabel,
  normalizeEmail,
  normalizePhone,
  normalizePhoneE164,
  parseBeds,
  parseRentToCents,
  parseDateOrNull,
  hasReachableContact,
  preferenceSummary,
  matchesVacancy,
  matchingEntries,
  type WaitlistMatchEntry,
  type VacancyProperty,
} from "@/lib/waitlist";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("FAIL:", name);
  }
}
function eq<T>(name: string, got: T, want: T) {
  ok(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

// ---- status ----------------------------------------------------------------
eq("isWaitlistStatus active", isWaitlistStatus("active"), true);
eq("isWaitlistStatus junk", isWaitlistStatus("waiting"), false);
eq("label active", waitlistStatusLabel("active"), "Waiting");
eq("label converted", waitlistStatusLabel("converted"), "Converted");
eq("label removed", waitlistStatusLabel("removed"), "Removed");
eq("label null default", waitlistStatusLabel(null), "Waiting");

// ---- email -----------------------------------------------------------------
eq("email trims+lowercases", normalizeEmail("  Jane@Example.COM "), "jane@example.com");
eq("email blank -> null", normalizeEmail("   "), null);
eq("email no-at -> null", normalizeEmail("notanemail"), null);
eq("email no-dot -> null", normalizeEmail("a@b"), null);
eq("email with spaces -> null", normalizeEmail("a b@c.com"), null);

// ---- phone -----------------------------------------------------------------
eq("phone trims", normalizePhone("  519-555-1212 "), "519-555-1212");
eq("phone blank -> null", normalizePhone(""), null);
eq("e164 10-digit", normalizePhoneE164("(519) 555-1212"), "+15195551212");
eq("e164 11-digit leading 1", normalizePhoneE164("1-519-555-1212"), "+15195551212");
eq("e164 too short -> null", normalizePhoneE164("555-1212"), null);
eq("e164 too long -> null", normalizePhoneE164("011519555121299"), null);

// ---- ints/rent/date --------------------------------------------------------
eq("beds parse", parseBeds("2"), 2);
eq("beds zero ok", parseBeds("0"), 0);
eq("beds blank -> null", parseBeds(""), null);
eq("beds negative -> null", parseBeds("-1"), null);
eq("beds absurd -> null", parseBeds("99"), null);
eq("rent $1,500 -> cents", parseRentToCents("$1,500"), 150000);
eq("rent 1500/mo -> cents", parseRentToCents("1500/mo"), 150000);
eq("rent blank -> null", parseRentToCents(""), null);
eq("rent junk -> null", parseRentToCents("abc"), null);
eq("date valid", parseDateOrNull("2026-08-01"), "2026-08-01");
eq("date malformed -> null", parseDateOrNull("Aug 1"), null);
eq("date blank -> null", parseDateOrNull(""), null);

// ---- reachable contact -----------------------------------------------------
eq("reachable via email", hasReachableContact({ email: "a@b.com", phone: null }), true);
eq("reachable via phone", hasReachableContact({ email: null, phone: "519-555-1212" }), true);
eq("reachable via bad-email + phone", hasReachableContact({ email: "junk", phone: "519-555-1212" }), true);
eq("not reachable (bad email, no phone)", hasReachableContact({ email: "junk", phone: "" }), false);
eq("not reachable (both blank)", hasReachableContact({ email: "", phone: "" }), false);

// ---- preference summary ----------------------------------------------------
eq(
  "pref summary full",
  preferenceSummary({ beds_min: 2, max_rent_cents: 180000, move_in_by: "2026-09-01" }),
  "2+ beds · up to $1,800/mo · by 2026-09-01",
);
eq("pref summary singular bed", preferenceSummary({ beds_min: 1, max_rent_cents: null, move_in_by: null }), "1+ bed");
eq("pref summary none", preferenceSummary({ beds_min: null, max_rent_cents: null, move_in_by: null }), "");

// ---- matchesVacancy --------------------------------------------------------
const prop: VacancyProperty = { id: "P1", status: "available", beds: 2, rent_cents: 150000 };
const base: WaitlistMatchEntry = {
  status: "active",
  property_id: "P1",
  beds_min: null,
  max_rent_cents: null,
  last_notified_property_id: null,
};

eq("match: active + this property", matchesVacancy(base, prop), true);
eq("no match: property not available", matchesVacancy(base, { ...prop, status: "leased" }), false);
eq("no match: entry not active", matchesVacancy({ ...base, status: "removed" }, prop), false);
eq("no match: entry converted", matchesVacancy({ ...base, status: "converted" }, prop), false);
eq("no match: tied to other property", matchesVacancy({ ...base, property_id: "P2" }, prop), false);
eq("match: org-wide entry (null property)", matchesVacancy({ ...base, property_id: null }, prop), true);
eq("no match: already notified for this property", matchesVacancy({ ...base, last_notified_property_id: "P1" }, prop), false);
eq("match: notified for a DIFFERENT property", matchesVacancy({ ...base, last_notified_property_id: "P9" }, prop), true);

// bedroom preference
eq("match: beds_min satisfied", matchesVacancy({ ...base, beds_min: 2 }, prop), true);
eq("no match: beds_min not satisfied", matchesVacancy({ ...base, beds_min: 3 }, prop), false);
eq("match: beds_min set but property beds unknown -> not excluded", matchesVacancy({ ...base, beds_min: 3 }, { ...prop, beds: null }), true);

// rent preference
eq("match: rent under cap", matchesVacancy({ ...base, max_rent_cents: 160000 }, prop), true);
eq("no match: rent over cap", matchesVacancy({ ...base, max_rent_cents: 140000 }, prop), false);
eq("match: rent cap set but property rent unknown -> not excluded", matchesVacancy({ ...base, max_rent_cents: 140000 }, { ...prop, rent_cents: null }), true);

// combined + filter
const entries: WaitlistMatchEntry[] = [
  { ...base, property_id: "P1" }, // match
  { ...base, property_id: "P2" }, // wrong property
  { ...base, property_id: null, beds_min: 2 }, // org-wide, beds ok -> match
  { ...base, status: "removed" }, // inactive
  { ...base, max_rent_cents: 140000 }, // rent too low -> no
  { ...base, last_notified_property_id: "P1" }, // already notified -> no
];
eq("matchingEntries count", matchingEntries(entries, prop).length, 2);

// ---- done ------------------------------------------------------------------
console.log(`waitlist: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
