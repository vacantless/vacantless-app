// S816b: the phone book. Run: npx tsx scripts/test-s816b-phone-book.ts
import { readFileSync } from "node:fs";
import { phoneKey, dialTarget, prettyPhone, dedupeBook, matchesBook, type BookEntry } from "../lib/phone-book";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}

ok("key strips 1", phoneKey("+1 (613) 929-8510") === "6139298510");
ok("key plain", phoneKey("6139298510") === "6139298510");
ok("dial ext", dialTarget("519-915-8865 ext 103") === "5199158865,103", dialTarget("519-915-8865 ext 103"));
ok("dial e164", dialTarget("+12267980746") === "+12267980746");
ok("pretty", prettyPhone("+12267980746") === "226-798-0746");
ok("pretty keeps ext", prettyPhone("519-915-8865 ext 103") === "519-915-8865 ext 103");

const e = (kind: BookEntry["kind"], phone: string, name = "Maya"): BookEntry => ({ key: kind + phone, name, phone, kind, detail: "1551 Assumption St", href: null });
const d = dedupeBook([e("Renter", "613-929-8510"), e("Tenant", "+16139298510"), e("Applicant", "6139298510"), e("Renter", "", "Nobody")]);
ok("dedupe keeps tenant", d.length === 1 && d[0].kind === "Tenant", d);
ok("search digits", matchesBook(e("Renter", "613-929-8510"), "8510"));
ok("search address", matchesBook(e("Renter", "1"), "assumption maya"));
ok("search miss", !matchesBook(e("Renter", "1"), "pillette"));

const page = readFileSync("app/dashboard/numbers/page.tsx", "utf8");
for (const label of ["Your texting number", "Rental questions", "Arrival number", "Emergency repairs", "Your alert mobile", "Showing agent", "Teammate"]) {
  ok(`page shows ${label}`, page.includes(label));
}
ok("nav links phone book", readFileSync("app/dashboard/dashboard-nav.tsx", "utf8").includes('href: "/dashboard/numbers"'));
ok("no em dash", !page.includes("—") && !readFileSync("lib/phone-book.ts", "utf8").includes("—"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
