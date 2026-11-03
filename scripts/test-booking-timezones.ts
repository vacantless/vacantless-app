// S747: one list of viewing time zones, every one with a plain label, and the
// national additions (Saskatchewan has no daylight saving; Yukon is its own).
import assert from "node:assert/strict";
import { BOOKING_TIMEZONES, timezoneLabel } from "../lib/timezone-label";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; };

ok(BOOKING_TIMEZONES[0] === "America/Toronto", "Toronto stays first (the default)");
for (const tz of ["America/Vancouver", "America/Edmonton", "America/Regina", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/Whitehorse"]) {
  ok(BOOKING_TIMEZONES.includes(tz), `${tz} is offered`);
}
ok(new Set(BOOKING_TIMEZONES).size === BOOKING_TIMEZONES.length, "no zone listed twice");
for (const tz of BOOKING_TIMEZONES) {
  ok(timezoneLabel(tz).endsWith(" time") && !timezoneLabel(tz).includes("/"), `${tz} has a plain label`);
}
ok(timezoneLabel("America/Regina") === "Saskatchewan time", "Regina reads as Saskatchewan time");
ok(timezoneLabel("America/Whitehorse") === "Yukon time", "Whitehorse reads as Yukon time");
for (const tz of BOOKING_TIMEZONES) {
  ok(Boolean(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())), `${tz} is a real zone`);
}
console.log(`booking-timezones: ${n} passed, 0 failed`);
