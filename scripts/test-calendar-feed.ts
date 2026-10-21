// Run with: npx tsx scripts/test-calendar-feed.ts
// S728: the subscribable viewings calendar (token + .ics body).
import { buildFeedIcs, signCalendarFeedToken, verifyCalendarFeedToken } from "../lib/calendar-feed";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const secret = "s3cret";
const orgId = "921f7c08-98af-428f-a238-36f4a781b0de";
const agentId = "0a455e72-4981-4a1a-9979-ca971dd3c0ef";
const orgTok = signCalendarFeedToken({ kind: "org", orgId }, secret);
const agentTok = signCalendarFeedToken({ kind: "agent", orgId, agentId }, secret);
ok("org token verifies", verifyCalendarFeedToken(orgTok, secret)?.kind === "org");
ok("agent token verifies with both ids", (() => { const v = verifyCalendarFeedToken(agentTok, secret); return v?.kind === "agent" && v.orgId === orgId && v.agentId === agentId; })());
ok(".ics suffix is tolerated", verifyCalendarFeedToken(orgTok + ".ics", secret)?.kind === "org");
ok("tampered token fails", verifyCalendarFeedToken(orgTok.slice(0, -1) + "0", secret) === null);
ok("org token is not an agent token", verifyCalendarFeedToken(orgTok.replace(/^o-/, "a-"), secret) === null);
ok("empty secret fails", verifyCalendarFeedToken(orgTok, "") === null);

const ics = buildFeedIcs({
  name: "Agile viewings",
  nowMs: Date.parse("2026-10-21T00:00:00Z"),
  viewings: [
    { showingId: "s1", startIso: "2026-10-22T21:00:00Z", minutes: 30, address: "833 Pillette Rd, Unit 3, Windsor, ON", orgName: "Agile", renterName: "Sam Lee", cancelled: false, pageUrl: "https://app.vacantless.com/dashboard/showings", updatedIso: null, agentName: "Aaliyah" },
    { showingId: "s2", startIso: "2026-10-23T15:00:00Z", minutes: 30, address: null, orgName: "Agile", renterName: null, cancelled: true, pageUrl: "https://app.vacantless.com/dashboard/showings", updatedIso: null },
  ],
});
ok("calendar name set", ics.includes("X-WR-CALNAME:Agile viewings"));
ok("two events", (ics.match(/BEGIN:VEVENT/g) ?? []).length === 2);
ok("summary names the renter and address", ics.includes("SUMMARY:Viewing: Sam Lee at 833 Pillette Rd\\, Unit 3\\, Windsor\\, ON"));
ok("cancelled viewing is marked", ics.includes("SUMMARY:Cancelled: Viewing") && ics.includes("STATUS:CANCELLED"));
ok("agent in the description", ics.includes("Showing agent: Aaliyah"));
ok("no renter phone or email anywhere", !/@|\+1\d{10}/.test(ics.replace(/UID:[^\r\n]*/g, "")));
ok("CRLF line endings", ics.includes("\r\n") && !/[^\r]\n/.test(ics));
ok("no em dash", !ics.includes("—"));
console.log(`calendar-feed: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
