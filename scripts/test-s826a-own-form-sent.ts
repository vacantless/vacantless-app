// S826a: one wording for "own application form sent", read back by the renter
// page and the rented notice.
import { isOwnFormSentNote, lastOwnFormSentAt, ownFormSentNote } from "../lib/own-form-sent";
import { rentalApplicationInviteHtml } from "../lib/email";
import { expandSkipByEmail, leadsToCloseQuietly, leadsToNotify } from "../lib/rented-notice";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", name);
  }
}

const emailed = ownFormSentNote({ formName: "Buildium", to: "Gina Jeon", by: "you", emailed: true });
ok("emailed note", emailed === "Buildium application link sent to Gina Jeon by you (emailed).");
const copied = ownFormSentNote({ formName: null, to: "416-555-0101", by: "Maya (showing agent)", emailed: false });
ok("phone-only note says it was not emailed", copied.includes("not emailed") && copied.startsWith("Your own application link sent to"));
ok("both read back as sent", isOwnFormSentNote(emailed, "note") && isOwnFormSentNote(copied, "note"));
ok("the S818b wording still reads back", isOwnFormSentNote("Buildium application link sent to Ann by you (emailed).", "note"));
ok("an email row is not a send note", !isOwnFormSentNote(emailed, "email"));
ok("other notes are not", !isOwnFormSentNote("Rental application sent to Ann.", "note"));
ok("no em dashes", !emailed.includes("—") && !copied.includes("—"));

const at = lastOwnFormSentAt([
  { channel: "note", body: emailed, created_at: "2026-11-20T15:00:00Z" },
  { channel: "note", body: copied, created_at: "2026-11-21T15:00:00Z" },
  { channel: "email", body: emailed, created_at: "2026-11-22T15:00:00Z" },
  { channel: "note", body: "Called", created_at: "2026-11-23T15:00:00Z" },
]);
ok("newest send wins, other rows ignored", at === "2026-11-21T15:00:00Z");
ok("never sent: null", lastOwnFormSentAt([]) === null);

const now = Date.parse("2026-11-21T18:00:00Z");
const leads = [
  { id: "a", name: "Ann", email: "a@x.test", status: "contacted", created_at: "2026-11-15T00:00:00Z" },
  { id: "b", name: "Bo", email: "b@x.test", status: "new", created_at: "2026-11-15T00:00:00Z" },
  { id: "c", name: "Cy", email: null, status: "new", created_at: "2026-11-15T00:00:00Z" },
];
const skip = new Set(["a", "c"]);
const notify = leadsToNotify(leads, now, skip);
ok("skipped renter not emailed", notify.map((l) => l.id).join(",") === "b");
ok("skipped renter not closed", leadsToCloseQuietly(leads, notify, skip).length === 0);
const twoRows = [...leads, { id: "d", name: "Ann", email: "A@x.test ", status: "replied", created_at: "2026-11-16T00:00:00Z" }];
ok("same email, second row skipped too", [...expandSkipByEmail(twoRows, new Set(["a"]))].sort().join(",") === "a,d");
ok("no skip list: unchanged", leadsToNotify(leads, now).map((l) => l.id).join(",") === "a,b");

const base = { applicant_name: "Gina Jeon", applicant_email: "g@x.test", org_name: "Agile", brand_color: null, logo_url: null, reply_to_email: null, property_address: "1551 Assumption St, Unit 9", apply_url: "https://x.managebuilding.com/Resident/rental-application/new" };
const own = rentalApplicationInviteHtml({ ...base, own_form: true });
const ours = rentalApplicationInviteHtml(base);
ok("own form: says which home to enter", own.includes("When the form asks which home you want, enter: <strong>1551 Assumption St, Unit 9</strong>."));
ok("own form: no SIN promise", !own.includes("SIN") && own.includes("never ask for your banking details by email"));
ok("our form: unchanged", !ours.includes("which home you want") && ours.includes("never ask for your SIN or banking details by email"));
ok("own form email has no em dashes", !own.includes("—"));
console.log(`\ns826a-own-form-sent: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
