// S820a: "Did you mean gmail.com?" for renter emails.
// Run: npx tsx scripts/test-s820a-email-typo.ts
import { readFileSync } from "node:fs";
import { suggestEmailFix } from "../lib/email-typo";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const fix = (a: string, want: string | null) => ok(`${a} -> ${want}`, suggestEmailFix(a) === want, suggestEmailFix(a));

// Victor's real slip.
fix("chidoh381@gmail.comc", "chidoh381@gmail.com");
fix("Chidoh381@Gmail.comc ", "chidoh381@gmail.com");
// Endings.
fix("a@gmail.con", "a@gmail.com");
fix("a@gmail.cm", "a@gmail.com");
fix("a@gmail.co", "a@gmail.com");
fix("a@hotmail.cpm", "a@hotmail.com");
fix("a@gmail.com.", null);
fix("a@gmailcom", "a@gmail.com");
fix("a@gmail", "a@gmail.com");
fix("a@gmail..com", "a@gmail.com");
// Names.
fix("a@gmial.com", "a@gmail.com");
fix("a@gamil.com", "a@gmail.com");
fix("a@gnail.com", "a@gmail.com");
fix("a@hotmial.com", "a@hotmail.com");
fix("a@hotmal.com", "a@hotmail.com");
fix("a@yaho.com", "a@yahoo.com");
fix("a@outlok.com", "a@outlook.com");
fix("a@iclod.com", "a@icloud.com");
fix("a@rogers.con", "a@rogers.com");
fix("a@sympatico.cc", "a@sympatico.ca");
// Fine as typed: never nag.
for (const good of ["a@gmail.com", "a@hotmail.ca", "a@yahoo.ca", "a@uwindsor.ca", "a@agileonline.ca", "a@royallepage.ca", "a@mail.com", "a@gmx.com", "a@live.ca", "a@me.com", "a@ymail.com", "a@hey.com"]) fix(good, null);
// Not an email.
fix("", null);
fix("nope", null);
fix("@gmail.com", null);
fix("a@", null);

// The public inquiry form shows the hint under the email box.
const form = readFileSync("app/r/[propertyId]/inquiry-form.tsx", "utf8");
ok("inquiry form uses suggestEmailFix", form.includes("suggestEmailFix"));
ok("inquiry form says Did you mean", form.includes("Did you mean"));
// The renter page offers fix-and-resend after a bounce.
const page = readFileSync("app/dashboard/leads/[id]/page.tsx", "utf8");
ok("renter page has the resend form", page.includes("resendWelcomeReply"));
const actions = readFileSync("app/dashboard/leads/actions.ts", "utf8");
ok("resend action exists", actions.includes("export async function resendWelcomeReply"));

console.log(`S820a email typo: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
