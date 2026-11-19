// S820b: the application, credit check and offer emails read right.
// Run: npx tsx scripts/test-s820b-application-emails.ts
import { readFileSync } from "node:fs";
import { applicationOfferInviteHtml, creditCheckInviteHtml, plainTextOfEmail, rentalApplicationInviteHtml } from "../lib/email";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const base = { org_name: "Lakeview Rentals", brand_color: null, logo_url: null, reply_to_email: "hello@lakeview.test", property_address: "100 Lakeview Ave, Windsor, ON" };

// 1. The offer says what happens next, names the other signer, has a footer.
const offer = applicationOfferInviteHtml({
  ...base,
  applicant_name: "Jordan Avery",
  applicant_email: "jordan@example.com",
  term_lines: ["Rent: $1,500 a month", "Starts: Dec 1, 2026", "Term: 12 months", "Deposit: $1,500"],
  offer_url: "https://app.vacantless.com/offer/abc",
  other_signers: ["Sam Avery"],
  conditions: "Tenant insurance before move-in.",
});
ok("offer: what happens next", offer.includes("What happens next"));
ok("offer: other signer named", offer.includes("Sam Avery gets their own link and signs too."));
ok("offer: everyone signs then in touch", offer.includes("Once everyone has signed, Lakeview Rentals will be in touch"));
ok("offer: decline is mentioned", offer.includes("decline on the same page"));
ok("offer: conditions shown", offer.includes("Tenant insurance before move-in."));
ok("offer: questions line with reply-to", offer.includes("Questions? Reply to this email, or write to hello@lakeview.test."));
ok("offer: footer", offer.includes("You are receiving this because you applied for a rental with Lakeview Rentals."));
const solo = applicationOfferInviteHtml({ ...base, reply_to_email: null, applicant_name: "Jordan", applicant_email: "j@example.com", term_lines: ["Rent: $1,500 a month"], offer_url: "https://x/offer/1" });
ok("offer solo: no other-signer line", !solo.includes("signs too"));
ok("offer solo: no conditions line", !solo.includes("Conditions:"));
ok("offer solo: questions without address", solo.includes("Questions? Reply to this email."));
const three = applicationOfferInviteHtml({ ...base, applicant_name: "A", applicant_email: "a@example.com", term_lines: [], offer_url: "https://x/o", other_signers: ["Sam", "Lee"] });
ok("offer: two others joined", three.includes("Sam and Lee get their own links and sign too."));

// 2. A co-applicant is told who added them, not "you inquired".
const co = rentalApplicationInviteHtml({ ...base, applicant_name: "Sam Avery", applicant_email: "sam@example.com", apply_url: "https://x/apply/1", added_by_name: "Jordan Avery" });
ok("co: who added them", co.includes("Jordan Avery added you to their application for <strong>100 Lakeview Ave, Windsor, ON</strong>"));
ok("co: footer names the renter", co.includes("because Jordan Avery added you to their rental application with Lakeview Rentals"));
ok("co: no 'you inquired'", !co.includes("you inquired"));
const main = rentalApplicationInviteHtml({ ...base, applicant_name: "Jordan Avery", applicant_email: "j@example.com", apply_url: "https://x/apply/2" });
ok("main applicant keeps 'you inquired'", main.includes("you inquired about a rental with Lakeview Rentals"));

// 3. Plain-text copies keep "$1,500" and the links.
const text = plainTextOfEmail(offer);
ok("text: comma kept", text.includes("Rent: $1,500 a month"), text);
ok("text: link kept", text.includes("https://app.vacantless.com/offer/abc"));
ok("text: no tags", !/<[a-z]/i.test(text));
ok("text: no style junk", !text.includes("font-family"));
ok("text: list bullets", text.includes("- Starts: Dec 1, 2026"));
const ctext = plainTextOfEmail(creditCheckInviteHtml({ ...base, applicant_name: "Jordan", applicant_email: "j@example.com", screening_name: "SingleKey", apply_url: "https://x/apply/3" }));
ok("credit text: company named", ctext.includes("Lakeview Rentals uses SingleKey."));

// The senders pass the plain text, and the actions pass the new fields.
const email = readFileSync("lib/email.ts", "utf8");
ok("three textContent copies", (email.match(/textContent: plainTextOfEmail\(/g) ?? []).length === 3);
const actions = readFileSync("app/dashboard/leads/actions.ts", "utf8");
ok("offer action passes other_signers", actions.includes("other_signers:"));
ok("co-applicant action passes addedByName", actions.includes("addedByName: isCo ? lead.name : null"));
const server = readFileSync("lib/rental-application-server.ts", "utf8");
ok("server passes added_by_name twice", (server.match(/added_by_name: args\.addedByName/g) ?? []).length === 2);

console.log(`S820b application emails: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
