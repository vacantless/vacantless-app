// Run with: npx tsx scripts/test-needs-you.ts
// S761: one Today card per site that signed the landlord out (REVIEW-S761 item 3).
import { readFileSync } from "node:fs";
import { needsYouNotices } from "../lib/needs-you";
import { countWords, splitSentences } from "../lib/i18n/plain-words";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const dead = needsYouNotices({ postingAllowed: true, tileStateByChannel: { kijiji: "linked", zumper: "dead_session", rentals_ca: "dead_session" } });
ok("two cards, in site order", dead.map((n) => n.channel).join(",") === "rentals_ca,zumper");
ok("title names the site", dead[1].title === "Zumper signed you out.");
ok("button opens the sign-in page", dead[1].action.href === "/dashboard/site-signin/zumper" && dead[1].action.label === "Sign in to Zumper");
ok("line says what stopped and how long", /stopped/.test(dead[0].line) && /2 minutes/.test(dead[0].line));
ok("short sentences", dead.every((n) => splitSentences(`${n.title} ${n.line}`).every((s) => countWords(s) <= 12)));
ok("no dash, no mechanism word", dead.every((n) => !/—|robot|session|extension/i.test(`${n.title} ${n.line} ${n.action.label}`)));

ok("never signed in is not a card", needsYouNotices({ postingAllowed: true, tileStateByChannel: { kijiji: "not_linked" } }).length === 0);
ok("checking is not a card", needsYouNotices({ postingAllowed: true, tileStateByChannel: { kijiji: "checking" } }).length === 0);
ok("linked is not a card", needsYouNotices({ postingAllowed: true, tileStateByChannel: { kijiji: "linked" } }).length === 0);
ok("no Posting, no card", needsYouNotices({ postingAllowed: false, tileStateByChannel: { zumper: "dead_session" } }).length === 0);
ok("hidden site, no card", needsYouNotices({ postingAllowed: true, tileStateByChannel: { rentals_ca: "dead_session" }, hiddenFor: (c) => c === "rentals_ca" }).length === 0);

// Wiring: Today renders the cards above the lane.
const today = readFileSync("app/dashboard/page.tsx", "utf8");
ok("Today reads the notices", /needsYouNotices\(/.test(today));
ok("Today renders NeedsYouCards", /<NeedsYouCards/.test(today));
ok("cards come before the lane", today.indexOf("<NeedsYouCards") < today.indexOf("<TodayLane"));

console.log(`needs-you: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
