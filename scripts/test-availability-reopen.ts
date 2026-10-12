// Run: npx tsx scripts/test-availability-reopen.ts

import {
  isReopenLeadEligible,
  REOPEN_NOTIFY_MAX_PER_ORG,
  reopenLeadsToNotify,
} from "../lib/availability-reopen";
import { NURTURE_MAX_AGE_MS } from "../lib/nurture";
import { readFileSync } from "node:fs";
import { viewingTimesOpenedSms } from "../lib/sms";
import { reopenSmsAllowed, textViewingTimesOpened } from "../lib/availability-reopen-sms";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

const nowMs = Date.parse("2026-07-18T16:00:00.000Z");
const createdAtMs = nowMs - 3 * 24 * 3_600_000;
const reopenedAtMs = nowMs - 60_000;

function eligible(
  overrides: Partial<Parameters<typeof isReopenLeadEligible>[0]> = {},
) {
  return isReopenLeadEligible({
    noSuitableTime: true,
    status: "new",
    propertyStatus: "available",
    createdAtMs,
    nowMs,
    reopenNotifiedAtMs: null,
    reopenedAtMs,
    ...overrides,
  });
}

ok("eligible: positive waiting lead", eligible());
ok("eligible: rejects normal inquiry", !eligible({ noSuitableTime: false }));
ok("eligible: rejects booked lead", !eligible({ status: "booked" }));
ok("eligible: rejects lost lead", !eligible({ status: "lost" }));
ok(
  "eligible: rejects unavailable property",
  !eligible({ propertyStatus: "leased" }),
);
ok(
  "eligible: rejects stale lead",
  !eligible({ createdAtMs: nowMs - NURTURE_MAX_AGE_MS - 1 }),
);
ok(
  "eligible: rejects org with no reopen stamp",
  !eligible({ reopenedAtMs: null }),
);
ok(
  "eligible: rejects already notified lead",
  !eligible({ reopenNotifiedAtMs: reopenedAtMs }),
);
ok(
  "eligible: accepts lead notified before this reopen",
  eligible({ reopenNotifiedAtMs: reopenedAtMs - 1 }),
);

{
  const stampedMs = reopenedAtMs + 1;
  ok(
    "once-per-reopen: stamped lead is ineligible for same reopen",
    !eligible({ reopenNotifiedAtMs: stampedMs }),
  );
  ok(
    "once-per-reopen: newer reopen makes lead eligible again",
    eligible({ reopenNotifiedAtMs: stampedMs, reopenedAtMs: stampedMs + 1 }),
  );
}

const sample = Array.from({ length: 40 }, (_, i) => i + 1);
ok(
  "open guard: no open slots returns nothing",
  reopenLeadsToNotify(0, sample).length === 0,
);
ok(
  "open guard: open slots returns eligible leads",
  reopenLeadsToNotify(5, sample).length === REOPEN_NOTIFY_MAX_PER_ORG,
);
ok(
  "cap: forty eligible leads caps at max per org",
  reopenLeadsToNotify(5, sample).length === REOPEN_NOTIFY_MAX_PER_ORG,
);
ok(
  "cap: fewer than max keeps all eligible leads",
  reopenLeadsToNotify(5, sample.slice(0, 3)).length === 3,
);


// --- S709: the text that goes with the "new viewing times opened" email ----
async function smsChecks() {
  const body = viewingTimesOpenedSms({
    org_name: "Agile Real Estate Group",
    property_address: "833 Pillette Rd, Unit 3",
    booking_url: "https://app.vacantless.com/r/abc",
  });
  ok("sms names the org, unit and link", body.startsWith("Agile Real Estate Group: new viewing times just opened for 833 Pillette Rd, Unit 3.") && body.includes("https://app.vacantless.com/r/abc"));
  ok("sms carries the opt-out line", body.endsWith("Reply STOP to opt out."));
  ok("sms has no em dash", !/[\u2012-\u2015]/.test(body));
  ok("sms fits two segments", body.length <= 306);

  const org = { id: "o1", name: "Agile", sms_enabled: true, plan: "growth", booking_timezone: "America/Toronto" };
  const noon = new Date("2026-10-12T16:00:00Z"); // 12:00 Toronto
  const night = new Date("2026-10-13T03:00:00Z"); // 23:00 Toronto
  ok("allowed: live, texting on, growth plan, daytime", reopenSmsAllowed(org, noon, true));
  ok("blocked when SMS is not live", !reopenSmsAllowed(org, noon, false));
  ok("blocked when the org has texting off", !reopenSmsAllowed({ ...org, sms_enabled: false }, noon, true));
  ok("blocked on a plan without renter texts", !reopenSmsAllowed({ ...org, plan: "free" }, noon, true));
  ok("blocked in quiet hours", !reopenSmsAllowed(org, night, true));

  function fakeAdmin(optedOut: boolean) {
    const inserts: unknown[] = [];
    const admin = {
      from(table: string) {
        if (table === "messages") return { insert: async (row: unknown) => { inserts.push(row); return { error: null }; } };
        const q: any = { select: () => q, eq: () => q, limit: async () => ({ data: optedOut ? [{ id: "x" }] : [] }) };
        return q;
      },
    };
    return { admin: admin as any, inserts };
  }
  const prevLive = process.env.SMS_LIVE;
  process.env.SMS_LIVE = "true";
  const sent: string[] = [];
  const send = async ({ to }: { to: string | null | undefined; body: string }) => { sent.push(String(to)); return { sent: true }; };
  const args = { org, leadId: "l1", propertyId: "p1", phone: "519-915-8865", address: "833 Pillette Rd, Unit 3" };
  const a = fakeAdmin(false);
  const texted = await textViewingTimesOpened(a.admin, args, noon, send as any);
  ok("eligible renter is texted once, to the E.164 number", texted === true && sent.length === 1 && sent[0] === "+15199158865");
  ok("a texted renter gets a timeline row", a.inserts.length === 1);
  const b = fakeAdmin(true);
  const before = sent.length;
  ok("opted-out renter is never texted", (await textViewingTimesOpened(b.admin, args, noon, send as any)) === false && sent.length === before);
  ok("no phone -> no text", (await textViewingTimesOpened(fakeAdmin(false).admin, { ...args, phone: null }, noon, send as any)) === false);
  ok("quiet hours -> no text", (await textViewingTimesOpened(fakeAdmin(false).admin, args, night, send as any)) === false);
  if (prevLive === undefined) delete process.env.SMS_LIVE; else process.env.SMS_LIVE = prevLive;

  const route = readFileSync("app/api/cron/availability-reopened-notify/route.ts", "utf8");
  ok("cron texts alongside the email", route.includes("textViewingTimesOpened(admin") && route.includes("sms_enabled, plan"));
  ok("cron stamps the lead when either channel went out", route.includes("if (!result.sent && !texted)"));
  ok("cron reads the renter phone", route.includes("name, email, phone, status"));
  const email = readFileSync("lib/email.ts", "utf8");
  ok("opened email subject has no em dash", email.includes("New viewing times just opened: ${p.property_address}"));
}

smsChecks().then(() => {
  console.log(`\navailability-reopen: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
