// Run with: npx tsx scripts/test-sms.ts
import {
  buildQuoPayload,
  normalizePhoneE164,
  selectSmsProvider,
  samePhone,
  classifyInbound,
  isWithinQuietHours,
  bookingConfirmationSms,
  showingReminderSms,
  waitlistVacancySms,
  smsSegments,
  computeTwilioSignature,
  verifyTwilioSignature,
} from "../lib/sms";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function deepEq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

const twilioEnv = env({
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_MESSAGING_SERVICE_SID: "MG123",
});
const quoEnv = env({
  QUO_API_KEY: "quo_key",
  QUO_FROM: "+15195551234",
});

// --- selectSmsProvider ------------------------------------------------------
eq("provider twilio-only -> twilio", selectSmsProvider(twilioEnv), "twilio");
eq("provider quo-only -> quo", selectSmsProvider(quoEnv), "quo");
eq(
  "provider both + SMS_PROVIDER=quo -> quo",
  selectSmsProvider(env({ ...twilioEnv, ...quoEnv, SMS_PROVIDER: "quo" })),
  "quo",
);
eq(
  "provider both + unset -> twilio",
  selectSmsProvider(env({ ...twilioEnv, ...quoEnv })),
  "twilio",
);
eq("provider neither -> none", selectSmsProvider(env({})), "none");
eq(
  "provider SMS_PROVIDER=quo but no QUO creds -> none",
  selectSmsProvider(env({ ...twilioEnv, SMS_PROVIDER: "quo" })),
  "none",
);

// --- buildQuoPayload --------------------------------------------------------
deepEq("quo payload 10-digit NANP", buildQuoPayload("519-555-1234", "Hello", "+15195550000"), {
  content: "Hello",
  from: "+15195550000",
  to: ["+15195551234"],
});
deepEq("quo payload already E.164", buildQuoPayload("+14165551234", "Hello", "+15195550000"), {
  content: "Hello",
  from: "+15195550000",
  to: ["+14165551234"],
});
eq("quo payload junk number -> null", buildQuoPayload("call me", "Hello", "+15195550000"), null);
eq("quo payload empty body -> null", buildQuoPayload("519-555-1234", "  ", "+15195550000"), null);

// --- normalizePhoneE164 -----------------------------------------------------
eq("10-digit NANP -> +1", normalizePhoneE164("519-555-1234"), "+15195551234");
eq("10-digit spaced", normalizePhoneE164("(519) 555 1234"), "+15195551234");
eq("11-digit leading 1", normalizePhoneE164("15195551234"), "+15195551234");
eq("already +1", normalizePhoneE164("+1 519 555 1234"), "+15195551234");
eq("intl +44", normalizePhoneE164("+44 20 7946 0958"), "+442079460958");
eq("empty -> null", normalizePhoneE164(""), null);
eq("null -> null", normalizePhoneE164(null), null);
eq("too short -> null", normalizePhoneE164("12345"), null);
eq("9 digits ambiguous -> null", normalizePhoneE164("519555123"), null);
eq("letters only -> null", normalizePhoneE164("call me"), null);

// --- samePhone --------------------------------------------------------------
ok("samePhone formats match", samePhone("(519) 555-1234", "+15195551234"));
ok("samePhone differs", !samePhone("5195551234", "4165551234"));
ok("samePhone null safe", !samePhone(null, "5195551234"));

// --- classifyInbound --------------------------------------------------------
eq("STOP", classifyInbound("STOP"), "stop");
eq("stop lowercase", classifyInbound("stop"), "stop");
eq("STOP with punctuation", classifyInbound("Stop!"), "stop");
eq("UNSUBSCRIBE", classifyInbound("unsubscribe"), "stop");
eq("CANCEL", classifyInbound("Cancel"), "stop");
eq("leading space + STOP", classifyInbound("  STOP please"), "stop");
eq("START", classifyInbound("start"), "start");
eq("YES -> start", classifyInbound("YES"), "start");
eq("UNSTOP -> start", classifyInbound("unstop"), "start");
eq("normal text -> null", classifyInbound("Hi, is this still available?"), null);
eq("empty -> null", classifyInbound(""), null);
eq("null -> null", classifyInbound(null), null);

// --- isWithinQuietHours (America/Toronto, EDT in June = UTC-4) ---------------
ok("23:00 local is quiet", isWithinQuietHours(new Date("2026-06-16T03:00:00Z"), "America/Toronto"));
ok("noon local not quiet", !isWithinQuietHours(new Date("2026-06-16T16:00:00Z"), "America/Toronto"));
ok("07:00 local is quiet (before 8)", isWithinQuietHours(new Date("2026-06-16T11:00:00Z"), "America/Toronto"));
ok("21:00 local is quiet (at end)", isWithinQuietHours(new Date("2026-06-17T01:00:00Z"), "America/Toronto"));
ok("bad tz -> false (don't block)", !isWithinQuietHours(new Date(), "Not/AZone"));

// --- message builders -------------------------------------------------------
const copy = {
  org_name: "Agile Rentals",
  property_address: "833 Pillette Rd, Unit 6",
  when_label: "Wed, Jun 17 at 2:00 PM",
};
const booking = bookingConfirmationSms(copy);
ok("booking includes org", booking.includes("Agile Rentals"));
ok("booking includes address", booking.includes("833 Pillette Rd, Unit 6"));
ok("booking includes when", booking.includes("Wed, Jun 17 at 2:00 PM"));
ok("booking includes opt-out line", booking.includes("Reply STOP to opt out."));
eq(
  "booking default copy unchanged",
  booking,
  "Agile Rentals: your viewing at 833 Pillette Rd, Unit 6 is confirmed for Wed, Jun 17 at 2:00 PM. Reply here if you need to reschedule. Reply STOP to opt out.",
);
ok("booking has no em dash", !/[‒–—―]/.test(booking));
ok("booking <= 2 segments", smsSegments(booking) <= 2);
const bookingConfirmFirst = bookingConfirmationSms({
  ...copy,
  booking_requires_confirmation: true,
});
ok("booking confirm-first says request is in", bookingConfirmFirst.includes("your viewing request"));
ok("booking confirm-first says agent confirms", bookingConfirmFirst.includes("will reach out to confirm before your viewing"));
ok("booking confirm-first avoids confirmed phrasing", !bookingConfirmFirst.includes("is confirmed for"));
ok("booking confirm-first has opt-out", bookingConfirmFirst.includes("Reply STOP to opt out."));
ok("booking confirm-first has no em dash", !/[‒–—―]/.test(bookingConfirmFirst));
ok("booking confirm-first <= 2 segments", smsSegments(bookingConfirmFirst) <= 2);

const r24 = showingReminderSms(copy, "24h");
const r2 = showingReminderSms(copy, "2h");
ok("24h reminder opt-out", r24.includes("Reply STOP to opt out."));
ok("2h reminder opt-out", r2.includes("Reply STOP to opt out."));
ok("24h vs 2h differ", r24 !== r2);
ok("2h says coming up soon", r2.includes("coming up soon"));
ok("reminder no em dash", !/[‒–—―]/.test(r24) && !/[‒–—―]/.test(r2));
ok("24h reminder <= 2 segments", smsSegments(r24) <= 2);

// builders degrade with missing fields
const bare = bookingConfirmationSms({ org_name: null, property_address: null, when_label: "soon" });
ok("bare booking still has opt-out", bare.includes("Reply STOP to opt out."));
ok("bare booking fallback org", bare.includes("Our leasing team"));
ok("bare booking fallback address", bare.includes("the property"));

// --- smsSegments ------------------------------------------------------------
eq("empty -> 0 segments", smsSegments(""), 0);
eq("short ascii -> 1", smsSegments("Hello"), 1);
eq("161 ascii -> 2", smsSegments("a".repeat(161)), 2);
eq("70 unicode -> 1", smsSegments("é".repeat(70)), 1);
eq("71 unicode -> 2", smsSegments("é".repeat(71)), 2);

// --- Twilio signature (canonical doc vector) --------------------------------
const docUrl = "https://mycompany.com/myapp.php?foo=1&bar=2";
const docParams = {
  Digits: "1234",
  To: "+18005551212",
  From: "+14158675309",
  Caller: "+14158675309",
  CallSid: "CA1234567890ABCDE",
};
eq(
  "twilio canonical signature",
  computeTwilioSignature("12345", docUrl, docParams),
  "RSOYDt4T1cUTdK1PDd93/VVr8B8=",
);
ok(
  "verify accepts correct signature",
  verifyTwilioSignature("12345", docUrl, docParams, "RSOYDt4T1cUTdK1PDd93/VVr8B8="),
);
ok(
  "verify rejects tampered params",
  !verifyTwilioSignature(
    "12345",
    docUrl,
    { ...docParams, Digits: "9999" },
    "RSOYDt4T1cUTdK1PDd93/VVr8B8=",
  ),
);
ok("verify rejects wrong token", !verifyTwilioSignature("wrong", docUrl, docParams, "RSOYDt4T1cUTdK1PDd93/VVr8B8="));
ok("verify rejects empty signature", !verifyTwilioSignature("12345", docUrl, docParams, ""));
// round-trip with a fresh token
const sig = computeTwilioSignature("sk_test_token", "https://x.io/sms", { From: "+15195551234", Body: "STOP" });
ok("round-trip verify", verifyTwilioSignature("sk_test_token", "https://x.io/sms", { From: "+15195551234", Body: "STOP" }, sig));

// waiting-list vacancy alert (S458)
const wl = waitlistVacancySms({
  org_name: "Agile",
  property_address: "123 King St W",
  rent_label: "$1,850/month",
});
ok("waitlist alert includes opt-out line", wl.includes("Reply STOP to opt out."));
ok("waitlist alert names the address", wl.includes("123 King St W"));
ok("waitlist alert includes the rent label", wl.includes("$1,850/month"));
ok("waitlist alert <= 2 segments", smsSegments(wl) <= 2);
const wlBare = waitlistVacancySms({ org_name: null, property_address: null, rent_label: null });
ok("bare waitlist alert still has opt-out", wlBare.includes("Reply STOP to opt out."));
ok("bare waitlist alert has fallback phrasing", wlBare.includes("a rental you asked about"));

console.log(`\nsms: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
