import { demandCheck, daysSince } from "../lib/demand-check";
let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) pass++; else { fail++; console.log("FAIL", n); } }
ok("early", demandCheck({ daysLive: 1, renters14: 1, renters7: 1, booked14: 0 }).tone === "early");
ok("early but busy is not early", demandCheck({ daysLive: 1, renters14: 6, renters7: 6, booked14: 2 }).tone !== "early");
ok("quiet", demandCheck({ daysLive: 10, renters14: 0, renters7: 0, booked14: 0 }).tone === "quiet");
ok("unknown days, no renters = quiet", demandCheck({ daysLive: null, renters14: 0, renters7: 0, booked14: 0 }).tone === "quiet");
ok("not booking", demandCheck({ daysLive: 10, renters14: 6, renters7: 3, booked14: 0 }).tone === "not_booking");
ok("few book", demandCheck({ daysLive: 10, renters14: 20, renters7: 10, booked14: 2 }).headline === "Few renters book");
ok("strong", demandCheck({ daysLive: 10, renters14: 20, renters7: 12, booked14: 5 }).tone === "strong");
ok("steady", demandCheck({ daysLive: 10, renters14: 4, renters7: 2, booked14: 1 }).tone === "steady");
ok("facts", demandCheck({ daysLive: 10, renters14: 4, renters7: 1, booked14: 1 }).facts === "1 renter this week, 4 in 2 weeks, 1 viewing booked");
ok("no em dash", !JSON.stringify(demandCheck({ daysLive: 9, renters14: 0, renters7: 0, booked14: 0 })).includes("—"));
ok("daysSince", daysSince("2026-11-10T00:00:00Z", Date.parse("2026-11-16T12:00:00Z")) === 6 && daysSince(null) === null);
console.log(`test-demand-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
