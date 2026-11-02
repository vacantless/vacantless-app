// S742e: "this one rented, here are the others".
import { leadsToCloseQuietly, leadsToNotify, RENTED_NOTICE_MAX_PER_PROPERTY } from "../lib/rented-notice";
import { rentedNoticeHtml, rentedNoticeSubject } from "../lib/email";
import { notifyWaitingRentersRented } from "../lib/rented-notice-server";
import { MARKETING_EMAIL_KINDS } from "../lib/renter-email-block";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", name);
  }
}

process.env.CRON_SECRET = process.env.CRON_SECRET || "test-signing-secret";
const now = Date.parse("2026-11-01T20:00:00Z");
const day = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

// who is written to
const leads = [
  { id: "a", name: "Ann", email: "ann@x.test", status: "new", created_at: iso(2 * day) },
  { id: "b", name: "Bo", email: "BO@x.test", status: "contacted", created_at: iso(10 * day) },
  { id: "c", name: "Cy", email: null, status: "new", created_at: iso(1 * day) },
  { id: "d", name: "Di", email: "di@x.test", status: "showed", created_at: iso(1 * day) },
  { id: "e", name: "Ed", email: "ed@x.test", status: "new", created_at: iso(90 * day) },
  { id: "f", name: "Ann again", email: "ann@x.test", status: "replied", created_at: iso(5 * day) },
  { id: "g", name: "Gus", email: "gus@x.test", status: "lost", created_at: iso(1 * day) },
];
const notify = leadsToNotify(leads, now);
ok("open, recent, emailed renters are written to", notify.map((l) => l.id).join(",") === "a,b");
ok("no email is not written to", !notify.some((l) => l.id === "c"));
ok("a renter past the viewing stage is left alone", !notify.some((l) => l.id === "d"));
ok("an old request is left alone", !notify.some((l) => l.id === "e"));
ok("one email per address", !notify.some((l) => l.id === "f"));
ok("already lost is left alone", !notify.some((l) => l.id === "g"));
const quiet = leadsToCloseQuietly(leads, notify);
ok("open requests that cannot be emailed still close", quiet.map((l) => l.id).sort().join(",") === "c,e,f");
ok("closed and shown stages do not close again", !quiet.some((l) => l.id === "d" || l.id === "g"));
const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: null, email: `m${i}@x.test`, status: "new", created_at: iso(day) }));
ok("capped per rental", leadsToNotify(many, now).length === RENTED_NOTICE_MAX_PER_PROPERTY);

// the email
ok("subject names the rental", rentedNoticeSubject("12 Main St, Unit 2") === "12 Main St, Unit 2 has been rented");
ok("kind is marketing, so an unsubscribed renter is skipped", MARKETING_EMAIL_KINDS.has("rented_notice"));
const base = {
  lead_id: "a", property_id: "p1", renter_name: "Ann Lee", renter_email: "ann@x.test", org_name: "Maple Door",
  brand_color: "#0f5132", logo_url: null, mail_alias: null, reply_to_email: null, property_address: "12 Main St, Unit 2",
};
const withOthers = rentedNoticeHtml({
  ...base,
  others: [
    { property_id: "p2", address: "14 Main St, Unit 1", rent_cents: 145000, beds: 1, baths: 1 },
    { property_id: "p3", address: "9 Elm <b>Ave</b>", rent_cents: null, beds: 2, baths: null },
  ],
});
ok("greets by first name", withOthers.includes("Hi Ann,"));
ok("says it rented", withOthers.includes("It has been rented"));
ok("lists the other homes with a booking link", withOthers.includes("14 Main St, Unit 1") && withOthers.includes("/r/p2") && withOthers.includes("See it and book a viewing"));
ok("rent and beds on the card", withOthers.includes("1 bed / 1 bath") && withOthers.includes("$1,450/month"));
ok("addresses are escaped", withOthers.includes("9 Elm &lt;b&gt;Ave&lt;/b&gt;") && !withOthers.includes("<b>Ave</b>"));
ok("unsubscribe footer present", withOthers.includes("Unsubscribe"));
const none = rentedNoticeHtml({ ...base, others: [] });
ok("no other homes: honest line, no cards", none.includes("Nothing else is open with us today") && !none.includes("See it and book"));
ok("no em dashes", !withOthers.includes("—") && !none.includes("—"));

// the orchestrator with a fake client and a fake Brevo
process.env.BREVO_API_KEY = "test-key";
const sent: { to: { email: string }[]; subject: string }[] = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  sent.push(JSON.parse(String(init?.body ?? "{}")));
  return new Response(JSON.stringify({ messageId: "x" }), { status: 201 });
}) as typeof fetch;

type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>, log: { updates: Row[]; inserts: Row[] }) {
  return {
    from: (table: string) => {
      const q: any = {
        _filters: [] as [string, unknown][],
        select: () => q, eq: (c: string, v: unknown) => { q._filters.push([c, v]); return q; },
        is: () => q, neq: (c: string, v: unknown) => { q._filters.push([`neq:${c}`, v]); return q; },
        in: (c: string, v: unknown) => { q._filters.push([`in:${c}`, v]); return q; },
        order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null }),
        update: (patch: Row) => { log.updates.push({ table, patch }); return q; },
        insert: async (row: Row) => { log.inserts.push({ table, ...row }); return { error: null }; },
        then: (res: any) => {
          let rows = tables[table] ?? [];
          const neq = q._filters.find((f: any) => String(f[0]).startsWith("neq:"));
          if (neq) rows = rows.filter((r) => r.id !== neq[1]);
          const inn = q._filters.find((f: any) => String(f[0]).startsWith("in:"));
          if (inn) rows = rows.filter((r) => (inn[1] as string[]).includes(r.id as string));
          return res({ data: rows, error: null });
        },
      };
      return q;
    },
  } as any;
}
const org = { id: "o1", name: "Maple Door", brand_color: "#0f5132", logo_url: null, mail_alias: null, reply_to_email: null } as any;

async function main() {
  const log = { updates: [] as Row[], inserts: [] as Row[] };
  const client = fakeClient({
    properties: [
      { id: "p1", address: "12 Main St, Unit 2", status: "leased" },
      { id: "p2", address: "14 Main St, Unit 1", rent_cents: 145000, beds: 1, baths: 1, status: "available" },
    ],
    leads: leads as Row[],
  }, log);
  const r = await notifyWaitingRentersRented({ client, org, propertyId: "p1", now: new Date(now) });
  ok("two renters emailed", r.sent === 2 && sent.length === 2);
  ok("emails went to the right people", sent.map((s) => s.to[0].email).sort().join(",") === "BO@x.test,ann@x.test");
  ok("the other home is in the email", JSON.stringify(sent[0]).includes("14 Main St, Unit 1"));
  ok("every open request closed as lost", log.updates.some((u) => (u.patch as Row).status === "lost") && r.closed === 5);
  ok("one timeline line per email", log.inserts.filter((i) => i.table === "messages").length === 2 && String(log.inserts[0].body).startsWith("Rented notice sent to"));

  // not leased: nothing happens
  sent.length = 0;
  const log2 = { updates: [] as Row[], inserts: [] as Row[] };
  const r2 = await notifyWaitingRentersRented({ client: fakeClient({ properties: [{ id: "p1", status: "available" }], leads: leads as Row[] }, log2), org, propertyId: "p1", now: new Date(now) });
  ok("an available rental sends nothing", r2.skipped === "not_leased" && sent.length === 0 && log2.updates.length === 0);

  // a throwing client never throws out
  const r3 = await notifyWaitingRentersRented({ client: { from: () => { throw new Error("down"); } } as any, org, propertyId: "p1" });
  ok("errors are reported, not thrown", (r3.skipped ?? "").startsWith("error:"));

  console.log(`\nrented-notice: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
