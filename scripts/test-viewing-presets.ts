// S742i: one-tap viewing time presets.
import { LAST_WEEK_KEY, VIEWING_PRESETS, isViewingPresetKey, presetOpenedNotice, presetWindowsToAdd, repeatLastWeek, repeatSummary, timeRange, buildingShortName } from "../lib/viewing-presets";
let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) pass++; else { fail++; console.error("FAIL:", n); } }
ok("three presets", VIEWING_PRESETS.length === 3);
ok("every window is valid", VIEWING_PRESETS.every((p) => p.windows.every((w) => w.weekday >= 0 && w.weekday <= 6 && w.end_minute > w.start_minute && w.end_minute <= 1440)));
ok("key check", isViewingPresetKey("weekday_evenings") && !isViewingPresetKey("sundays") && !isViewingPresetKey(null));
ok("fresh org gets all five evenings", presetWindowsToAdd("weekday_evenings", []).length === 5);
ok("an overlapping Tuesday is skipped", presetWindowsToAdd("weekday_evenings", [{ weekday: 2, start_minute: 18 * 60, end_minute: 20 * 60 }]).length === 4);
ok("a non-overlapping Tuesday morning is not in the way", presetWindowsToAdd("weekday_evenings", [{ weekday: 2, start_minute: 9 * 60, end_minute: 11 * 60 }]).length === 5);
ok("touching windows do not overlap", presetWindowsToAdd("weekday_evenings", [{ weekday: 2, start_minute: 19 * 60, end_minute: 21 * 60 }]).length === 5);
ok("saturday preset is one window", presetWindowsToAdd("saturday_mornings", []).length === 1);
ok("notice names the preset and the email", (presetOpenedNotice("weekday_evenings", 5) ?? "").includes("Weekday evenings are open") && (presetOpenedNotice("weekday_evenings", 5) ?? "").includes("within 15 minutes"));
ok("nothing added says so", (presetOpenedNotice("saturday_mornings", 0) ?? "").includes("already open"));
ok("unknown key, no notice", presetOpenedNotice("bogus", 1) === null && presetOpenedNotice(null, null) === null);
ok("no em dashes", !VIEWING_PRESETS.some((p) => `${p.label}${p.detail}`.includes("—")));

// S804: Same as last week. Agile's real pattern, Nov 2026 (today Mon 2026-11-16).
const agile = [
  { day: "2026-11-04", start_minute: 1110, end_minute: 1200 },
  { day: "2026-11-05", start_minute: 1140, end_minute: 1230 },
  { day: "2026-11-09", start_minute: 1020, end_minute: 1140 },
  { day: "2026-11-10", start_minute: 1020, end_minute: 1140 },
  { day: "2026-11-12", start_minute: 1020, end_minute: 1140 },
  { day: "2026-11-13", start_minute: 1020, end_minute: 1140 },
];
const rep = repeatLastWeek(agile, "2026-11-16");
ok("last week only (Nov 7 to 13), moved to the next 7 days", JSON.stringify(rep.map((w) => w.day)) === JSON.stringify(["2026-11-16", "2026-11-17", "2026-11-19", "2026-11-20"]));
ok("hours kept", rep.every((w) => w.start_minute === 1020 && w.end_minute === 1140));
ok("summary reads like Aaliyah", repeatSummary(rep) === "Mon, Tue, Thu and Fri 5 to 7 pm");
ok("a day off is skipped", repeatLastWeek(agile, "2026-11-16", ["2026-11-17"]).length === 3);
ok("no history, nothing offered", repeatLastWeek([], "2026-11-16").length === 0);
ok("future times are not history", repeatLastWeek([{ day: "2026-11-20", start_minute: 600, end_minute: 660 }], "2026-11-16").length === 0);
ok("a Monday last week lands today", repeatLastWeek([{ day: "2026-11-09", start_minute: 600, end_minute: 660 }], "2026-11-16")[0]?.day === "2026-11-16");
ok("a Sunday lands on the coming Sunday", repeatLastWeek([{ day: "2026-11-15", start_minute: 600, end_minute: 660 }], "2026-11-16")[0]?.day === "2026-11-22");
ok("two windows one day both kept", repeatLastWeek([{ day: "2026-11-12", start_minute: 660, end_minute: 780 }, { day: "2026-11-12", start_minute: 1020, end_minute: 1140 }], "2026-11-16").length === 2);
ok("mixed summary", repeatSummary([{ day: "2026-11-18", start_minute: 660, end_minute: 780 }, { day: "2026-11-19", start_minute: 1110, end_minute: 1200 }]) === "Wed 11 am to 1 pm; Thu 6:30 to 8 pm");
ok("time range noon", timeRange(720, 780) === "12 to 1 pm" && timeRange(540, 600) === "9 to 10 am");
ok("last week notice", (presetOpenedNotice(LAST_WEEK_KEY, 4) ?? "").includes("next 7 days") && (presetOpenedNotice(LAST_WEEK_KEY, 0) ?? "").includes("already open"));
ok("no em dashes in summary", !repeatSummary(rep).includes("—"));
const agileDays = [
  { weekday: 1, building_key: "1551 assumption st, windsor, on n9a 3e2" },
  { weekday: 2, building_key: "1551 assumption st, windsor, on n9a 3e2" },
  { weekday: 4, building_key: "833 pillette rd, windsor, on n8y 3b4" },
  { weekday: 5, building_key: "833 pillette rd, windsor, on n8y 3b4" },
];
ok("summary names each building", repeatSummary(rep, agileDays) === "Mon and Tue 5 to 7 pm at 1551 Assumption St; Thu and Fri 5 to 7 pm at 833 Pillette Rd");
ok("building short name", buildingShortName("833 pillette rd, windsor, on n8y 3b4") === "833 Pillette Rd");
ok("a day with no building set says no building", repeatSummary([{ day: "2026-11-18", start_minute: 1020, end_minute: 1140 }], agileDays) === "Wed 5 to 7 pm");
console.log(`\nviewing-presets: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
