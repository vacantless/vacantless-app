// Unit tests for the pure prorated-rent engine (lib/proration.ts).
// Run: npx tsx scripts/test-proration.ts
import {
  PRORATION_METHODS,
  PRORATION_TOKENS,
  isProrationToken,
  daysInMonth,
  parseISODate,
  formatMoneyCents,
  computeProration,
  prorationVarValues,
  ordinalDay,
  clampRentDay,
  rentDayInMonth,
} from "../lib/proration";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- constants + guards -----------------------------------------------------
ok("methods are calendar/thirty_day", PRORATION_METHODS.join(",") === "calendar,thirty_day");
ok("tokens are the four prorated-rent placeholders",
  Object.values(PRORATION_TOKENS).sort().join(",") ===
    ["full_rent_start_date", "prorated_period_end", "prorated_period_start", "prorated_rent"].join(","));
ok("isProrationToken accepts known", Object.values(PRORATION_TOKENS).every((t) => isProrationToken(t)));
ok("isProrationToken is case-insensitive", isProrationToken("Prorated_Rent"));
ok("isProrationToken rejects others", !isProrationToken("parking_fee") && !isProrationToken("rent"));

// --- daysInMonth ------------------------------------------------------------
ok("daysInMonth June = 30", daysInMonth(2026, 6) === 30);
ok("daysInMonth July = 31", daysInMonth(2026, 7) === 31);
ok("daysInMonth Feb 2026 = 28", daysInMonth(2026, 2) === 28);
ok("daysInMonth Feb 2024 (leap) = 29", daysInMonth(2024, 2) === 29);
ok("daysInMonth Feb 2000 (div-400 leap) = 29", daysInMonth(2000, 2) === 29);
ok("daysInMonth Feb 1900 (div-100 not leap) = 28", daysInMonth(1900, 2) === 28);
ok("daysInMonth Dec = 31", daysInMonth(2026, 12) === 31);
ok("daysInMonth out-of-range = 0", daysInMonth(2026, 13) === 0 && daysInMonth(2026, 0) === 0);

// --- parseISODate -----------------------------------------------------------
ok("parseISODate valid", JSON.stringify(parseISODate("2026-06-17")) === JSON.stringify({ year: 2026, month: 6, day: 17 }));
ok("parseISODate trims", parseISODate("  2026-06-17  ")?.day === 17);
ok("parseISODate rejects bad month", parseISODate("2026-13-01") === null);
ok("parseISODate rejects day past month length", parseISODate("2026-02-30") === null);
ok("parseISODate accepts Feb 29 in leap year", parseISODate("2024-02-29")?.day === 29);
ok("parseISODate rejects Feb 29 in non-leap", parseISODate("2026-02-29") === null);
ok("parseISODate rejects non-date", parseISODate("June 17") === null && parseISODate("") === null);
ok("parseISODate rejects datetime", parseISODate("2026-06-17T00:00:00Z") === null);

// --- formatMoneyCents -------------------------------------------------------
ok("formatMoneyCents shows 2 decimals", formatMoneyCents(58333) === "$583.33");
ok("formatMoneyCents thousands separator", formatMoneyCents(125000) === "$1,250.00");
ok("formatMoneyCents rounds", formatMoneyCents(58333.7) === "$583.34");
ok("formatMoneyCents clamps negatives to 0", formatMoneyCents(-100) === "$0.00");
ok("formatMoneyCents whole dollars still show cents", formatMoneyCents(60000) === "$600.00");

// --- computeProration: the screenshot case (June 17, $1,250) ----------------
const june = computeProration(125000, "2026-06-17")!;
ok("june computes (non-null)", june !== null);
ok("june applicable (mid-month)", june.applicable === true);
ok("june periodStart = start date", june.periodStart === "2026-06-17");
ok("june periodEnd = month end", june.periodEnd === "2026-06-30");
ok("june fullRentStart = next 1st", june.fullRentStart === "2026-07-01");
ok("june daysInMonth = 30", june.daysInMonth === 30);
ok("june calendar charges 14 days", june.calendar.daysCharged === 14);
ok("june calendar amount = $583.33", june.calendar.formatted === "$583.33" && june.calendar.cents === 58333);
ok("june 30-day charges 14 days", june.thirtyDay.daysCharged === 14);
ok("june methods agree (30-day month)", june.methodsAgree === true && june.thirtyDay.formatted === "$583.33");

// --- July 17 (31-day month): methods diverge --------------------------------
const july = computeProration(125000, "2026-07-17")!;
ok("july periodEnd = 2026-07-31", july.periodEnd === "2026-07-31");
ok("july fullRentStart = 2026-08-01", july.fullRentStart === "2026-08-01");
ok("july calendar charges 15 days", july.calendar.daysCharged === 15);
ok("july calendar amount = $604.84", july.calendar.formatted === "$604.84");
ok("july 30-day charges 14 days = $583.33", july.thirtyDay.daysCharged === 14 && july.thirtyDay.formatted === "$583.33");
ok("july methods disagree", july.methodsAgree === false);

// --- Feb 17 2026 (28-day month) ---------------------------------------------
const feb = computeProration(125000, "2026-02-17")!;
ok("feb periodEnd = 2026-02-28", feb.periodEnd === "2026-02-28");
ok("feb calendar charges 12 days", feb.calendar.daysCharged === 12);
ok("feb calendar amount = $535.71", feb.calendar.formatted === "$535.71");
ok("feb fullRentStart = 2026-03-01", feb.fullRentStart === "2026-03-01");

// --- Feb 17 2024 (leap, 29-day) ---------------------------------------------
const febLeap = computeProration(125000, "2024-02-17")!;
ok("feb leap periodEnd = 2024-02-29", febLeap.periodEnd === "2024-02-29");
ok("feb leap calendar charges 13 days", febLeap.calendar.daysCharged === 13);

// --- December roll to next year ---------------------------------------------
const dec = computeProration(125000, "2026-12-17")!;
ok("dec periodEnd = 2026-12-31", dec.periodEnd === "2026-12-31");
ok("dec fullRentStart rolls year = 2027-01-01", dec.fullRentStart === "2027-01-01");

// --- start on the 1st: no proration -----------------------------------------
const first = computeProration(125000, "2026-06-01")!;
ok("first-of-month not applicable", first.applicable === false);
ok("first-of-month calendar charges full 30 days", first.calendar.daysCharged === 30 && first.calendar.cents === 125000);

// --- start on the 31st: 30-day flat charges 0 (clamped, not negative) -------
const day31 = computeProration(125000, "2026-07-31")!;
ok("31st calendar charges 1 day", day31.calendar.daysCharged === 1);
ok("31st 30-day clamps to 0 days", day31.thirtyDay.daysCharged === 0 && day31.thirtyDay.cents === 0);

// --- invalid inputs return null ---------------------------------------------
ok("null rent -> null", computeProration(null, "2026-06-17") === null);
ok("zero rent -> null", computeProration(0, "2026-06-17") === null);
ok("negative rent -> null", computeProration(-100, "2026-06-17") === null);
ok("bad date -> null", computeProration(125000, "nope") === null);
ok("missing date -> null", computeProration(125000, null) === null);

// --- prorationVarValues -----------------------------------------------------
const calVals = prorationVarValues(july, "calendar");
ok("varValues fills all four tokens", Object.keys(calVals).sort().join(",") ===
  ["full_rent_start_date", "prorated_period_end", "prorated_period_start", "prorated_rent"].join(","));
ok("varValues calendar amount", calVals.prorated_rent === "$604.84");
ok("varValues period start = start date", calVals.prorated_period_start === "2026-07-17");
ok("varValues period end = month end", calVals.prorated_period_end === "2026-07-31");
ok("varValues full rent start = next 1st", calVals.full_rent_start_date === "2026-08-01");
const flatVals = prorationVarValues(july, "thirty_day");
ok("varValues 30-day amount differs", flatVals.prorated_rent === "$583.33");
ok("varValues dates are method-independent", flatVals.prorated_period_end === calVals.prorated_period_end);
ok("varValues defaults to calendar", prorationVarValues(july).prorated_rent === "$604.84");

// --- ordinalDay (anniversary note) ------------------------------------------
ok("ordinalDay 1 -> 1st", ordinalDay(1) === "1st");
ok("ordinalDay 2 -> 2nd", ordinalDay(2) === "2nd");
ok("ordinalDay 3 -> 3rd", ordinalDay(3) === "3rd");
ok("ordinalDay 4 -> 4th", ordinalDay(4) === "4th");
ok("ordinalDay 11 -> 11th (teen)", ordinalDay(11) === "11th");
ok("ordinalDay 12 -> 12th (teen)", ordinalDay(12) === "12th");
ok("ordinalDay 13 -> 13th (teen)", ordinalDay(13) === "13th");
ok("ordinalDay 17 -> 17th", ordinalDay(17) === "17th");
ok("ordinalDay 21 -> 21st", ordinalDay(21) === "21st");
ok("ordinalDay 22 -> 22nd", ordinalDay(22) === "22nd");
ok("ordinalDay 23 -> 23rd", ordinalDay(23) === "23rd");
ok("ordinalDay 31 -> 31st", ordinalDay(31) === "31st");

// --- clampRentDay -----------------------------------------------------------
ok("clampRentDay passes valid day", clampRentDay(15) === 15);
ok("clampRentDay floors below 1 to 1", clampRentDay(0) === 1 && clampRentDay(-5) === 1);
ok("clampRentDay caps above 31 to 31", clampRentDay(99) === 31);
ok("clampRentDay null/undefined -> 1", clampRentDay(null) === 1 && clampRentDay(undefined) === 1);
ok("clampRentDay NaN -> 1", clampRentDay(NaN) === 1);
ok("clampRentDay truncates fractions", clampRentDay(15.7) === 15);

// --- rentDayInMonth (end-of-month clamp) ------------------------------------
ok("rentDayInMonth 31st in Feb 2026 -> 28", rentDayInMonth(2026, 2, 31) === 28);
ok("rentDayInMonth 31st in Feb 2024 (leap) -> 29", rentDayInMonth(2024, 2, 31) === 29);
ok("rentDayInMonth 31st in April -> 30", rentDayInMonth(2026, 4, 31) === 30);
ok("rentDayInMonth 15th in June -> 15", rentDayInMonth(2026, 6, 15) === 15);

// --- rentDay default reproduces the day-1 path ------------------------------
const juneDefault = computeProration(125000, "2026-06-17", 1)!;
ok("explicit rentDay=1 matches default rentDay field", juneDefault.rentDay === 1);
ok("explicit rentDay=1 same amount as omitted", juneDefault.calendar.formatted === june.calendar.formatted);
ok("omitted rentDay reports rentDay=1", june.rentDay === 1);
ok("explicit rentDay=1 same fullRentStart", juneDefault.fullRentStart === "2026-07-01");

// --- custom rent day, same-month stub (rent on the 15th, start June 10) -----
const r15a = computeProration(125000, "2026-06-10", 15)!;
ok("r15a applicable", r15a.applicable === true);
ok("r15a rentDay = 15", r15a.rentDay === 15);
ok("r15a periodStart = start", r15a.periodStart === "2026-06-10");
ok("r15a periodEnd = day before rent day", r15a.periodEnd === "2026-06-14");
ok("r15a fullRentStart = this month's 15th", r15a.fullRentStart === "2026-06-15");
ok("r15a calendar charges 5 days", r15a.calendar.daysCharged === 5);
ok("r15a cycle length = 31 (May15->Jun15)", r15a.daysInMonth === 31);
ok("r15a calendar amount = $201.61", r15a.calendar.formatted === "$201.61");
ok("r15a 30-day charges 4 days = $166.67", r15a.thirtyDay.daysCharged === 4 && r15a.thirtyDay.formatted === "$166.67");
ok("r15a methods disagree", r15a.methodsAgree === false);

// --- custom rent day, cross-month stub (rent on the 15th, start June 20) ----
const r15b = computeProration(125000, "2026-06-20", 15)!;
ok("r15b periodStart = start", r15b.periodStart === "2026-06-20");
ok("r15b periodEnd = next 14th", r15b.periodEnd === "2026-07-14");
ok("r15b fullRentStart = next month's 15th", r15b.fullRentStart === "2026-07-15");
ok("r15b calendar charges 25 days", r15b.calendar.daysCharged === 25);
ok("r15b cycle length = 30 (Jun15->Jul15)", r15b.daysInMonth === 30);
ok("r15b calendar amount = $1,041.67", r15b.calendar.formatted === "$1,041.67");
ok("r15b methods agree (30-day cycle)", r15b.methodsAgree === true);

// --- anniversary collapse (rent day == start day) ---------------------------
const anniv = computeProration(125000, "2026-06-17", 17)!;
ok("anniversary not applicable", anniv.applicable === false);
ok("anniversary fullRentStart = next 17th", anniv.fullRentStart === "2026-07-17");
ok("anniversary calendar = full month", anniv.calendar.cents === 125000 && anniv.calendar.formatted === "$1,250.00");

// --- end-of-month clamp (rent on the 31st, start Feb 10 2026) ---------------
const r31 = computeProration(125000, "2026-02-10", 31)!;
ok("r31 applicable", r31.applicable === true);
ok("r31 fullRentStart clamps to Feb 28", r31.fullRentStart === "2026-02-28");
ok("r31 periodEnd = Feb 27", r31.periodEnd === "2026-02-27");
ok("r31 calendar charges 18 days = $803.57", r31.calendar.daysCharged === 18 && r31.calendar.formatted === "$803.57");
const r31on = computeProration(125000, "2026-01-31", 31)!;
ok("start on a clamped rent day still no proration", r31on.applicable === false && r31on.fullRentStart === "2026-02-28");

// --- year roll forward (rent on the 15th, start Dec 20 2026) ----------------
const decRoll = computeProration(125000, "2026-12-20", 15)!;
ok("decRoll fullRentStart rolls year = 2027-01-15", decRoll.fullRentStart === "2027-01-15");
ok("decRoll periodEnd = 2027-01-14", decRoll.periodEnd === "2027-01-14");
ok("decRoll calendar amount = $1,048.39", decRoll.calendar.formatted === "$1,048.39");

// --- year roll backward for the previous anchor (start Jan 10 2026, day 15) --
const janRoll = computeProration(125000, "2026-01-10", 15)!;
ok("janRoll fullRentStart = 2026-01-15", janRoll.fullRentStart === "2026-01-15");
ok("janRoll periodEnd = 2026-01-14", janRoll.periodEnd === "2026-01-14");
ok("janRoll cycle = 31 (Dec15 2025 -> Jan15 2026)", janRoll.daysInMonth === 31);

// --- prorationVarValues flows custom dates ----------------------------------
const r15bVals = prorationVarValues(r15b, "calendar");
ok("custom varValues period start", r15bVals.prorated_period_start === "2026-06-20");
ok("custom varValues full rent start", r15bVals.full_rent_start_date === "2026-07-15");
ok("custom varValues amount", r15bVals.prorated_rent === "$1,041.67");

console.log(`proration: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
