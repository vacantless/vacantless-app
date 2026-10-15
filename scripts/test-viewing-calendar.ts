// Run with: npx tsx scripts/test-viewing-calendar.ts   (S721 "Add to calendar")
import {
  signViewingCalendarToken,
  verifyViewingCalendarToken,
  buildViewingIcs,
  googleCalendarUrl,
  icsEscape,
  icsFold,
  icsUtc,
  type CalendarViewing,
} from "../lib/viewing-calendar";
import { calendarLineHtml } from "../lib/email";
import { NOTIFICATION_EVENTS, renderNotification } from "../lib/notifications";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const SECRET = "test-secret";
const ID = "6cd43bf3-3b2a-4ac8-b475-f779d12817a4";

// Token: round trip, tamper, wrong secret, junk.
const tok = signViewingCalendarToken(ID, SECRET);
ok("token shape", /^[0-9a-f-]{36}\.[0-9a-f]{32}$/.test(tok));
ok("verify round trip", verifyViewingCalendarToken(tok, SECRET) === ID);
ok("verify uppercase ok", verifyViewingCalendarToken(tok.toUpperCase(), SECRET) === ID);
ok("wrong secret refused", verifyViewingCalendarToken(tok, "other") === null);
ok("tampered sig refused", verifyViewingCalendarToken(tok.slice(0, -1) + (tok.endsWith("0") ? "1" : "0"), SECRET) === null);
ok("other id same sig refused", verifyViewingCalendarToken("00000000-0000-0000-0000-000000000000" + tok.slice(36), SECRET) === null);
ok("bare id refused", verifyViewingCalendarToken(ID, SECRET) === null);
ok("junk refused", verifyViewingCalendarToken("x.y", SECRET) === null);
ok("empty secret refused", verifyViewingCalendarToken(tok, "") === null);
ok("null refused", verifyViewingCalendarToken(null, SECRET) === null);

const v: CalendarViewing = {
  showingId: ID,
  startIso: "2026-10-16T21:00:00.000Z", // 5:00 PM Toronto
  minutes: 30,
  address: "833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4",
  orgName: "Agile Real Estate Group",
  renterName: "Kiara Agostinis",
  cancelled: false,
  pageUrl: `https://app.vacantless.com/showing/calendar/${tok}`,
};
const NOW = Date.UTC(2026, 9, 15, 17, 0, 0);
const ics = buildViewingIcs(v, NOW);
ok("utc format", icsUtc(v.startIso) === "20261016T210000Z");
ok("crlf only", !/[^\r]\n/.test(ics));
ok("start", ics.includes("DTSTART:20261016T210000Z"));
ok("end = start + 30 min", ics.includes("DTEND:20261016T213000Z"));
ok("uid stable", ics.includes(`UID:viewing-${ID}@vacantless.com`));
ok("confirmed", ics.includes("STATUS:CONFIRMED") && ics.includes("BEGIN:VALARM"));
ok("location escaped commas", ics.includes("LOCATION:833 Pillette Rd\\, Unit 3\\, Windsor\\, ON N8Y 3B4"));
ok("no em dash", !ics.includes("—"));
ok("every line <= 75 octets", ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
const later = buildViewingIcs(v, NOW + 60_000);
const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)?.[1]);
ok("sequence grows with time", seq(later) > seq(ics));
const cx = buildViewingIcs({ ...v, cancelled: true }, NOW);
ok("cancelled status", cx.includes("STATUS:CANCELLED") && !cx.includes("VALARM") && cx.includes("SUMMARY:Cancelled: Rental viewing"));
ok("default 30 min when 0", buildViewingIcs({ ...v, minutes: 0 }, NOW).includes("DTEND:20261016T213000Z"));
ok("45 min", buildViewingIcs({ ...v, minutes: 45 }, NOW).includes("DTEND:20261016T214500Z"));

ok("escape", icsEscape("a;b,c\\d\ne") === "a\\;b\\,c\\\\d\\ne");
const long = "DESCRIPTION:" + "é".repeat(80);
ok("fold multibyte", icsFold(long).split("\r\n").every((l) => Buffer.byteLength(l) <= 75) && icsFold(long).replace(/\r\n /g, "") === long);

const g = new URL(googleCalendarUrl(v));
ok("google host", g.host === "calendar.google.com");
ok("google dates", g.searchParams.get("dates") === "20261016T210000Z/20261016T213000Z");
ok("google text", g.searchParams.get("text") === "Rental viewing: 833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4");
ok("google location", g.searchParams.get("location") === v.address);

// Email line.
ok("no url no line", calendarLineHtml(null, "#000") === "" && calendarLineHtml("  ", "#000") === "");
ok("line has link", calendarLineHtml("https://x/y", "#000").includes('href="https://x/y"'));
ok("moved line says delete", calendarLineHtml("https://x/y", "#000", true).includes("delete that one"));

// Alert bodies carry the link (all three default templates).
for (const key of ["leasing.viewing_booked", "leasing.showing_assigned", "leasing.showing_rescheduled"]) {
  const ev = NOTIFICATION_EVENTS.find((e) => e.key === key);
  ok(`${key} exists`, !!ev);
  if (!ev) continue;
  ok(`${key} declares token`, ev.tokens.includes("calendar_url"));
  const r = renderNotification(ev, null, { calendar_url: "https://cal/link" });
  ok(`${key} body has link`, r.body.includes("https://cal/link"));
  ok(`${key} no em dash`, !r.body.includes("—"));
}

console.log(`viewing-calendar: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
