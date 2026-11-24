// S838: reply and viewing times in the monthly reports.
// Run: npx tsx scripts/test-s838-response-times.ts
import { readFileSync } from "node:fs";
import { durationWords, responseFacts, responseLines, type TimedLead } from "../lib/response-times";

let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

const L = (source: string, createdAt: string, reply: string | null, booked: string | null = null, viewing: string | null = null): TimedLead =>
  ({ source, createdAt, firstReplyAt: reply, firstBookedAt: booked, firstViewingAt: viewing });

const leads = [
  L("Kijiji", "2026-11-02T10:00:00Z", "2026-11-02T10:00:02Z", "2026-11-02T10:30:00Z", "2026-11-04T10:00:00Z"),
  L("Zumper + PadMapper", "2026-11-03T10:00:00Z", "2026-11-03T10:00:03Z"),
  L("website", "2026-11-04T10:00:00Z", "2026-11-04T10:05:00Z", "2026-11-04T12:00:00Z", "2026-11-06T12:00:00Z"),
  L("Facebook Marketplace", "2026-11-05T10:00:00Z", null),
  L("Facebook Marketplace", "2026-11-06T10:00:00Z", null, "2026-11-06T11:00:00Z", "2026-11-07T11:00:00Z"),
];
const f1 = responseFacts(leads);
ok("counts", f1.renters === 5 && f1.replied === 3 && f1.withinMinute === 2 && f1.notTimed === 2 && f1.notTimedMarketplace === 2, f1);
ok("median reply 3 s", f1.medianReplySeconds === 3, f1);
ok("booked 3, median 1 h to book", f1.booked === 3 && f1.medianToBookHours === 1, f1);
ok("median to viewing 2 days", f1.medianToViewingHours === 48, f1);
const lines = responseLines(f1);
ok("reply line", lines[0] === "Response time: 3 of 5 renters got a reply from Vacantless, 2 of them within a minute (typically 3 seconds).", lines);
ok("marketplace not timed, not averaged", lines[1] === "The other 2 are Marketplace chats, answered in Messenger, which Vacantless cannot time.", lines);
ok("viewing line with the Marketplace clock caveat", lines[2] === "3 renters booked a viewing, typically 1 hour after first asking, for a viewing 2 days after asking. For Marketplace renters the clock starts when the chat was saved to Vacantless.", lines);

const allFast = responseLines(responseFacts([L("Kijiji", "2026-11-02T10:00:00Z", "2026-11-02T10:00:02Z")]));
ok("one renter, all replied", allFast[0] === "Response time: The renter got a reply from Vacantless within a minute (typically 2 seconds).", allFast);
ok("no booked line without a viewing", allFast.length === 1, allFast);

const mixed = responseLines(responseFacts([L("Kijiji", "2026-11-02T10:00:00Z", null), L("Facebook Marketplace", "2026-11-02T10:00:00Z", null)]));
ok("untimed, not all Marketplace", mixed[0] === "These 2 renters had no reply sent through Vacantless. Marketplace chats are answered in Messenger and are not timed.", mixed);
ok("nothing to say for no renters", responseLines(responseFacts([])).length === 0);
ok("no Marketplace caveat without a Marketplace booking", !responseLines(responseFacts([leads[0]])).join(" ").includes("Marketplace renters"));
ok("bad dates are not timed", responseFacts([L("Kijiji", "x", "2026-11-02T10:00:02Z")]).replied === 0);

ok("words: seconds", durationWords(2.4) === "2 seconds" && durationWords(0.2) === "1 second");
ok("words: minutes", durationWords(300) === "5 minutes");
ok("words: hours", durationWords(3600) === "1 hour" && durationWords(30 * 3600) === "30 hours");
ok("words: days", durationWords(72 * 3600) === "3 days");

const rr = readFileSync("lib/rental-report.ts", "utf8");
ok("rental report prints the lines in Response so far", /responseLines\(responseFacts\(input\.timedLeads \?\? \[\]\)\)/.test(rr) && rr.indexOf("responseLines(") < rr.indexOf('heading: "Response so far"'));
const rs = readFileSync("lib/rental-report-server.ts", "utf8");
ok("rental report loads the month's renters' times", rs.includes("loadTimedLeads(admin, monthRows)") && rs.includes("timedLeads,"));
const ar = readFileSync("lib/account-report.ts", "utf8");
ok("account summary html and text", (ar.match(/responseText/g) ?? []).length >= 3);
ok("account summary loads them", readFileSync("lib/account-report-server.ts", "utf8").includes("loadTimedLeads(db, monthLeads)"));
const srv = readFileSync("lib/response-times-server.ts", "utf8");
ok("a reply is only an outbound email or text", srv.includes('.eq("direction", "outbound").in("channel", ["email", "sms"])'));

console.log(`s838-response-times: ${p} passed, ${f} failed`);
if (f) process.exit(1);
