// Run with: npx tsx scripts/test-s845c-sold-chat.ts
// S845c: a chat on a taken-down Marketplace ad (title "SOLD - ...", no price).
import { othersForRented, rentedChatReply, soldAdRental } from "../lib/send-shortcut";
import { buildScreenshotPrompt } from "../lib/ai-screenshot-lead";
import { normalizeEnquiryRead } from "../lib/ai-enquiry";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const u9 = { id: "u9", address: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", rentDollars: 1095, beds: 1 };
const b303 = { id: "b303", address: "1195 Bruce Ave, Unit 303, Windsor, ON", rentDollars: 1250, beds: 1 };
ok("one recent takedown is the rental", soldAdRental(true, [u9])?.id === "u9");
ok("the same rental twice is still one", soldAdRental(true, [u9, u9])?.id === "u9");
ok("two recent takedowns: cannot tell", soldAdRental(true, [u9, b303]) === null);
ok("no SOLD line: never guessed", soldAdRental(false, [u9]) === null && soldAdRental(undefined, [u9]) === null);

const open = [
  { address: "833 Pillette Rd, Unit 36, Windsor, ON", rentDollars: 1450, beds: 2, url: "https://app.vacantless.com/r/36" },
  { address: "833 Pillette Rd, Unit 3, Windsor, ON", rentDollars: 1250, beds: 1, url: "https://app.vacantless.com/r/3" },
  { address: "833 Pillette Rd, Unit 33, Windsor, ON", rentDollars: 1225, beds: 1, url: "https://app.vacantless.com/r/33" },
];
const others = othersForRented(1, open);
ok("same bedrooms first, cheapest first", others.length === 2 && others[0].rentDollars === 1225 && others[1].rentDollars === 1250);
ok("no same-bed rental: offer what is open", othersForRented(3, open).length === 3);
const text = rentedChatReply({ rentalName: u9.address, renterName: "Tammy Lee", others });
ok("says the unit is rented", text.startsWith("Hi Tammy, thanks for asking. Unit 9 at 1551 Assumption St is rented now."));
ok("names both open units with links", text.includes("Unit 33 at 833 Pillette Rd, $1,225 a month: https://app.vacantless.com/r/33") && text.includes("/r/3"));
ok("no dash", !/[–—]/.test(text));
ok("nothing open: just rented", rentedChatReply({ rentalName: u9.address, renterName: null, others: [] }) === "Hi, thanks for asking. Unit 9 at 1551 Assumption St is rented now.");

ok("prompt asks for ad_sold", buildScreenshotPrompt([]).includes('"ad_sold"'));
const server = readFileSync("lib/send-shortcut-server.ts", "utf8");
ok("SOLD with no match drops a guessed pick", server.includes("if (!rentedHit) read.rentalId = null;"));
ok("only removed Marketplace ads, last 30 days", server.includes('.eq("portal", "facebook")') && server.includes('.gte("down_at", since)'));
const route = readFileSync("app/api/shortcut/renter/route.ts", "utf8");
ok("route copies the rented reply", route.includes("reply = r.rentedReply;"));
void normalizeEnquiryRead;
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
