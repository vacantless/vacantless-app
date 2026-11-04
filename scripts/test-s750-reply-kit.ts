// S750: Quick replies (the phone reply kit). Run: npx tsx scripts/test-s750-reply-kit.ts
import { buildReplyKitCards, longDayLabel, nextTimesLabel, replyKitText } from "../lib/reply-kit";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const APP = "https://app.vacantless.com";
const props = [
  { id: "p3", address: "833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4", rent_cents: 125000, beds: 1, baths: 1, status: "available", archived_at: null },
  { id: "p9", address: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", rent_cents: 109500, beds: 1, baths: 1, status: "available", archived_at: null },
  { id: "p303", address: "Bruce 303", rent_cents: 150000, beds: 2, baths: 1, status: "leased", archived_at: null },
  { id: "pgone", address: "Old", rent_cents: 100000, beds: 1, baths: 1, status: "leased", archived_at: null },
  { id: "parch", address: "Archived", rent_cents: 100000, beds: 1, baths: 1, status: "available", archived_at: "2026-01-01" },
];
const posts = [
  { id: "fb3", property_id: "p3", portal: "facebook", status: "live" },
  { id: "kj3", property_id: "p3", portal: "kijiji", status: "live" },
  { id: "old3", property_id: "p3", portal: "zumper", status: "removed" },
  { id: "fb303", property_id: "p303", portal: "facebook", status: "live" },
];
const times = new Map([["p3", { hasViewingTimes: true, nextTimes: "Thursday, November 5 at 7:30, 7:45, 8:00 or 8:15 PM" }]]);
const cards = buildReplyKitCards({ appUrl: APP, properties: props, posts, timesByProperty: times });

eq(cards.map((c) => c.propertyId), ["p9", "p3", "p303"], "available by rent, then rented-with-live-ad; no leased-without-ad, no archived");
const c3 = cards.find((c) => c.propertyId === "p3")!;
eq(c3.sites.map((s) => s.label), ["Marketplace", "Kijiji", "Text or other"], "live sites in order plus the plain link; removed ad skipped");
eq(c3.sites[0].bookingUrl, `${APP}/r/p3?p=fb3`, "Marketplace uses its own tracked link");
eq(c3.sites[2].bookingUrl, `${APP}/r/p3`, "text uses the plain link");
eq(c3.rentLabel, "$1,250/month", "rent label");
eq(c3.bedsLabel, "1 bed · 1 bath", "beds label");

eq(
  replyKitText({ card: c3, site: c3.sites[0], phone: "519-915-8865 ext 103", renterName: "Khushpreet" }),
  `Hi Khushpreet, yes it is still available. You can pick a viewing time here: ${APP}/r/p3?p=fb3 The next open times are Thursday, November 5 at 7:30, 7:45, 8:00 or 8:15 PM. If you would rather not fill out the form, you can also call 519-915-8865 ext 103.`,
  "the same reply sent to Khushpreet by hand, from the kit",
);
eq(
  replyKitText({ card: c3, site: c3.sites[1], phone: null, renterName: "" }).startsWith("Hi, yes it is still available."),
  true,
  "no name gives a plain Hi",
);
const c9 = cards.find((c) => c.propertyId === "p9")!;
eq(
  replyKitText({ card: c9, site: c9.sites[0], phone: null }).includes("next open times"),
  false,
  "no times known: no times line",
);
const c303 = cards.find((c) => c.propertyId === "p303")!;
eq(replyKitText({ card: c303, site: c303.sites[0], phone: "x", renterName: "Sam" }), "Hi Sam, thanks for asking. This one is rented now.", "rented reply");

const longDay = (k: string) => ({ "2026-11-05": "Thursday, November 5", "2026-11-06": "Friday, November 6" } as Record<string, string>)[k] ?? k;
eq(
  nextTimesLabel(
    [
      { dayKey: "2026-11-05", dayLabel: "Thu, Nov 5", slots: ["7:30 PM", "7:45 PM", "8:00 PM", "8:15 PM", "8:30 PM"].map((label) => ({ iso: "", label })) },
    ],
    longDay,
  ),
  "Thursday, November 5 at 7:30, 7:45, 8:00 or 8:15 PM",
  "first day, up to 4 times, one AM/PM",
);
eq(nextTimesLabel([{ dayKey: "2026-11-05", dayLabel: "", slots: [] }, { dayKey: "2026-11-06", dayLabel: "", slots: [{ iso: "", label: "10:00 AM" }] }], longDay), "Friday, November 6 at 10:00 AM", "skips empty days");
eq(nextTimesLabel([{ dayKey: "2026-11-05", dayLabel: "", slots: [{ iso: "", label: "11:30 AM" }, { iso: "", label: "12:00 PM" }] }], longDay), "Thursday, November 5 at 11:30 AM or 12:00 PM", "mixed AM/PM keeps each");
eq(nextTimesLabel([], longDay), null, "no times");

eq(longDayLabel("2026-11-05"), "Thursday, November 5", "long day label");
console.log(`\ns750 reply kit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
