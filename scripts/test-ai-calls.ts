// Run with: npx tsx scripts/test-ai-calls.ts
// S702: missed calls and voicemails become renters.
import { readFileSync } from "node:fs";
import { callBackSms, parseOpenPhoneCall, smsSegments } from "../lib/sms";
import { looksLikeEnquiryText, ENQUIRY_SYSTEM_PROMPT } from "../lib/ai-enquiry";
import { textBackCaller } from "../lib/ai-enquiry-ingest";
import { logInboundCall } from "../lib/sms-inbound";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

// --- copy ---
const sms = callBackSms({
  org_name: "Maple Rentals",
  property_address: "12 Elm St, Unit 4",
  booking_url: "https://app.vacantless.com/r/abc",
  answer: "Yes, parking is included.",
});
ok("sms has booking link", sms.includes("https://app.vacantless.com/r/abc"));
ok("sms has answer", sms.includes("parking is included"));
ok("sms has STOP", sms.includes("Reply STOP to opt out."));
ok("sms no em dash", !/[—–]/.test(sms));
ok("sms at most 2 segments", smsSegments(sms) <= 2);
const noLink = callBackSms({ org_name: null, property_address: null, booking_url: null });
ok("no link falls back to reply", noLink.includes("Reply here"));

// --- QUO call parse ---
const call = (o: Record<string, unknown>, type = "call.completed") => ({ type, data: { object: o } });
ok("ignores message events", parseOpenPhoneCall(call({ direction: "incoming", from: "+15195551234", to: ["+15195550000"] }, "message.received")) === null);
ok("ignores outgoing", parseOpenPhoneCall(call({ direction: "outgoing", from: "+15195551234", to: ["+15195550000"] })) === null);
const missed = parseOpenPhoneCall(call({ direction: "incoming", from: "+15195551234", to: ["+15195550000"], status: "no-answer" }));
ok("missed call parsed", missed !== null && missed.answered === false && missed.voicemail === false);
const vm = parseOpenPhoneCall(call({ direction: "incoming", from: "+15195551234", to: "+15195550000", status: "no-answer", voicemail: { url: "https://x/vm.mp3", duration: 12 } }));
ok("voicemail parsed", vm !== null && vm.voicemail === true);
const answered = parseOpenPhoneCall(call({ direction: "incoming", from: "+15195551234", to: ["+15195550000"], status: "completed", answeredAt: "2026-10-09T12:00:00Z" }));
ok("answered call", answered !== null && answered.answered === true);

// --- voicemail emails reach the AI reader ---
ok("voicemail email routes to reader", looksLikeEnquiryText("New voicemail from (519) 555-1234", "Hi, I'm calling about the apartment on Elm"));
ok("prompt names voicemail", /voicemail/i.test(ENQUIRY_SYSTEM_PROMPT));

// --- fake admin ---
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>) {
  const inserted: { table: string; rows: Row[] }[] = [];
  const client = {
    inserted,
    from(table: string) {
      const filters: [string, unknown][] = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null }),
        then: (res: any) => res({ data: rows() }),
        insert: async (r: Row | Row[]) => {
          inserted.push({ table, rows: Array.isArray(r) ? r : [r] });
          return { error: null };
        },
      };
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      return q;
    },
  };
  return client;
}

const noon = new Date("2026-10-09T16:00:00Z"); // 12:00 Toronto
const night = new Date("2026-10-10T03:00:00Z"); // 23:00 Toronto
const org = { id: "o1", sms_enabled: true, plan: "growth", booking_timezone: "America/Toronto" };
const args = {
  orgId: "o1",
  leadId: "l1",
  phone: "(519) 555-1234",
  orgName: "Maple Rentals",
  address: "12 Elm St",
  bookingUrl: "https://app.vacantless.com/r/abc",
  answer: null,
};

async function main() {
  const sent: string[] = [];
  const send = async ({ body }: { to: string | null | undefined; body: string }) => (sent.push(body), { sent: true });

  process.env.SMS_LIVE = "false";
  ok("no text when SMS is not live", (await textBackCaller(fakeAdmin({ organizations: [org] }) as any, args, noon, send)) === false);
  process.env.SMS_LIVE = "true";

  ok("no text when org has texts off", (await textBackCaller(fakeAdmin({ organizations: [{ ...org, sms_enabled: false }] }) as any, args, noon, send)) === false);
  ok("no text on Free plan", (await textBackCaller(fakeAdmin({ organizations: [{ ...org, plan: "free" }] }) as any, args, noon, send)) === false);
  ok("no text at night", (await textBackCaller(fakeAdmin({ organizations: [org] }) as any, args, night, send)) === false);
  ok("no text after STOP", (await textBackCaller(fakeAdmin({ organizations: [org], leads: [{ id: "x", phone_e164: "+15195551234", sms_opt_out: true }] }) as any, args, noon, send)) === false);
  ok("nothing sent so far", sent.length === 0);

  const a = fakeAdmin({ organizations: [org] });
  ok("texts the caller", (await textBackCaller(a as any, args, noon, send)) === true);
  ok("one text sent", sent.length === 1 && sent[0].includes("abc"));
  ok("text logged", a.inserted.some((i) => i.table === "messages" && i.rows[0].channel === "sms"));

  // --- logInboundCall ---
  const b = fakeAdmin({ leads: [{ id: "l1", organization_id: "o1", phone_e164: "+15195551234" }] });
  const r1 = await logInboundCall(b as any, { from: "+15195551234", answered: false, voicemail: true });
  ok("missed call logged on lead", r1.messagesInserted === 1 && b.inserted[0].rows[0].channel === "call");
  ok("voicemail wording", String(b.inserted[0].rows[0].body).includes("voicemail"));
  const r2 = await logInboundCall(b as any, { from: "+15195551234", answered: true, voicemail: false });
  ok("answered call not logged", r2.messagesInserted === 0);
  const r3 = await logInboundCall(fakeAdmin({ leads: [] }) as any, { from: "+15195559999", answered: false, voicemail: false });
  ok("unknown caller ignored", r3.matchedLeads === 0);

  // --- wiring ---
  const route = readFileSync("app/api/quo/inbound/route.ts", "utf8");
  ok("QUO route logs calls", route.includes("logInboundCall") && route.includes("parseOpenPhoneCall"));
  const ingest = readFileSync("lib/ai-enquiry-ingest.ts", "utf8");
  ok("ingest texts phone-only callers", ingest.includes("textBackCaller(admin"));
  ok("Agile still excluded first", ingest.indexOf("ORGS_THAT_ANSWER_THEMSELVES.includes") < ingest.indexOf("textBackCaller(admin"));

  console.log(`\nai-calls: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
