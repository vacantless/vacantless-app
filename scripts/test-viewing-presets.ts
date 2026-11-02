// S742i: one-tap viewing time presets.
import { VIEWING_PRESETS, isViewingPresetKey, presetOpenedNotice, presetWindowsToAdd } from "../lib/viewing-presets";
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
console.log(`\nviewing-presets: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
