// S824j: "Also send to" on Every message we send. Run: npx tsx scripts/test-s824j-extra-recipients.ts
import { readFileSync } from "node:fs";
import { withExtras, loadExtraRecipients } from "../lib/message-recipients-server";
import { CATALOG_MESSAGES, EXTRA_RECIPIENT_MESSAGE_IDS, PHONE_LINKS } from "../lib/message-catalog";
import { validateRecipientsInput } from "../lib/notifications";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// Merge.
ok("owners first, extras after", JSON.stringify(withExtras(["a@x.com"], ["b@x.com"])) === JSON.stringify(["a@x.com", "b@x.com"]));
ok("no repeats, lower case", JSON.stringify(withExtras(["A@x.com"], ["a@x.com", " B@X.com "])) === JSON.stringify(["a@x.com", "b@x.com"]));
ok("blanks dropped", withExtras(["", "a@x.com"], [""]).length === 1);
ok("no extras keeps owners", JSON.stringify(withExtras(["a@x.com"], [])) === JSON.stringify(["a@x.com"]));

// Every id is a real catalog row and the SQL check matches.
const catalogIds = new Set(CATALOG_MESSAGES.map((m) => m.id));
for (const id of EXTRA_RECIPIENT_MESSAGE_IDS) ok(`catalog has ${id}`, catalogIds.has(id));
for (const id of Object.keys(PHONE_LINKS)) ok(`catalog has phone row ${id}`, catalogIds.has(id));
const sql = read("supabase/migrations/0317_message_extra_recipients.sql");
// S831: 0321 widened the check for the monthly report.
const allowSql = sql + "\n" + read("supabase/migrations/0321_rental_report.sql");
for (const id of EXTRA_RECIPIENT_MESSAGE_IDS) ok(`0317 allows ${id}`, allowSql.includes(`'${id}'`));
ok("0317 grants service_role (rule 431)", /grant[^;]+to service_role/.test(sql));
ok("0317 has row security", sql.includes("enable row level security"));
ok("0317 caps at 20", sql.includes("<= 20"));

// Phone links point at the pages that really edit those phones.
ok("arrival phone on Settings messages tab", PHONE_LINKS["renter-booking-confirmation"]?.href === "/dashboard/settings?tab=comms");
ok("emergency phone on Repairs page", PHONE_LINKS["you-emergency-text"]?.href === "/dashboard/maintenance");

// The box parses like the other recipient boxes.
const v = validateRecipientsInput("a@x.com\nb@x.com, a@x.com");
ok("valid list parses", v.ok && v.value.length === 2);
ok("bad email refused", !validateRecipientsInput("not an email").ok);
ok("21 refused", !validateRecipientsInput(Array.from({ length: 21 }, (_, i) => `p${i}@x.com`).join("\n")).ok);
ok("empty is ok", (() => { const r = validateRecipientsInput(""); return r.ok && r.value.length === 0; })());

// Each sender merges the extras for its own row.
const senders: [string, string][] = [
  ["app/api/cron/posted-results-email/route.ts", "you-posted-results"],
  ["app/api/cron/signin-lost/route.ts", "you-signin-lost"],
  ["lib/site-mail-pass-server.ts", "you-site-mail"],
  ["lib/incident-notify-server.ts", "you-incident-report"],
];
for (const [file, id] of senders) {
  const src = read(file);
  ok(`${file} loads ${id}`, src.includes(`"${id}"`) && src.includes("loadExtraRecipients") && src.includes("withExtras("));
}
ok("closed account gets no extras", /closedBy \? \[\] :/.test(read("lib/site-mail-pass-server.ts")));

// The save action checks the permission and the id.
const action = read("app/dashboard/automations/every-message/actions.ts");
ok("save needs manage_settings", /saveExtraRecipients[\s\S]*manage_settings/.test(action));
ok("save checks the id", /saveExtraRecipients[\s\S]*EXTRA_RECIPIENT_MESSAGE_IDS/.test(action));
const page = read("app/dashboard/automations/every-message/page.tsx");
ok("page shows Also send to", page.includes("Also send to") && page.includes("saveExtraRecipients"));
ok("page shows phone links", page.includes("PHONE_LINKS[r.id]"));

// A failed read sends to the usual people only.
(async () => {
  const broken = { from: () => { throw new Error("down"); } } as never;
  const r = await loadExtraRecipients(broken, "org", "you-site-mail");
  ok("broken read gives none", Array.isArray(r) && r.length === 0);
  const fake = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { emails: ["B@x.com", "b@x.com", "c@x.com"] } }) }) }) }) }),
  } as never;
  const r2 = await loadExtraRecipients(fake, "org", "you-site-mail");
  ok("read lower-cases and dedupes", JSON.stringify(r2) === JSON.stringify(["b@x.com", "c@x.com"]), r2);
  const r3 = await loadExtraRecipients(fake, "org", "renter-booking-confirmation" as never);
  ok("unknown id gives none", r3.length === 0);
  console.log(`s824j extra recipients: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
