// Run with: npx tsx scripts/test-slot-fallback.ts
//
// Guards the S410 P2 fix: a viewing slot selected from a day that is currently
// collapsed out of view (day 4+ while "More times" is closed) must still count
// as "not rendered" so the booking form emits a hidden fallback and the choice
// is not silently dropped into an inquiry.

import {
  COLLAPSED_DAY_COUNT,
  selectedSlotIsRendered,
  visibleBookingDays,
  type DaySlots,
} from "../lib/booking";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

// 5 days, one slot each, iso = "d0".."d4".
const days: DaySlots[] = Array.from({ length: 5 }, (_, i) => ({
  dayKey: `2026-07-0${i + 1}`,
  dayLabel: `Day ${i}`,
  slots: [{ iso: `d${i}`, label: `Day ${i} slot` }],
}));

ok("collapsed shows exactly COLLAPSED_DAY_COUNT days",
  visibleBookingDays(days, false).length === COLLAPSED_DAY_COUNT);
ok("expanded shows all days",
  visibleBookingDays(days, true).length === days.length);

// Empty selection is never "rendered".
ok("no selection -> not rendered (collapsed)", selectedSlotIsRendered(days, false, "") === false);
ok("no selection -> not rendered (expanded)", selectedSlotIsRendered(days, true, "") === false);

// Slots in the first COLLAPSED_DAY_COUNT days are rendered while collapsed.
ok("day 0 rendered when collapsed", selectedSlotIsRendered(days, false, "d0") === true);
ok("day 2 rendered when collapsed", selectedSlotIsRendered(days, false, "d2") === true);

// The bug: day 4+ selected, then collapsed -> radio is NOT rendered, so a hidden
// fallback is required (function returns false).
ok("day 3 NOT rendered when collapsed", selectedSlotIsRendered(days, false, "d3") === false);
ok("day 4 NOT rendered when collapsed", selectedSlotIsRendered(days, false, "d4") === false);

// Expanded, every real slot is rendered (no fallback needed).
ok("day 3 rendered when expanded", selectedSlotIsRendered(days, true, "d3") === true);
ok("day 4 rendered when expanded", selectedSlotIsRendered(days, true, "d4") === true);

// A stale/unknown iso is never rendered.
ok("unknown iso not rendered (expanded)", selectedSlotIsRendered(days, true, "nope") === false);

// Fewer than COLLAPSED_DAY_COUNT days: everything is visible, nothing hidden.
const twoDays = days.slice(0, 2);
ok("2-day set: both rendered collapsed",
  selectedSlotIsRendered(twoDays, false, "d0") && selectedSlotIsRendered(twoDays, false, "d1"));

console.log(`\nslot-fallback: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
