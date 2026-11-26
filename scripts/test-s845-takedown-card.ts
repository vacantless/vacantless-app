// Run with: npx tsx scripts/test-s845-takedown-card.ts
// S845: the ads-still-up card names why each ad is the landlord's to delete,
// shows a robot that gave up, and a second "I took it down" lands on a new URL.
import { handReason } from "../lib/ads-still-up";
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

ok("robot tried wins over site", handReason("zumper", true).includes("robot tried"));
ok("marketplace personal profile", handReason("facebook", false).includes("personal profile"));
ok("robot site not signed in", handReason("kijiji", false).includes("not signed in"));
ok("rentals.ca not signed in", handReason("rentals_ca", false).includes("not signed in"));
ok("other site is theirs", handReason("viewit", false).includes("do not post"));
for (const p of ["zumper", "facebook", "kijiji", "viewit"]) {
  ok(`no dash in ${p}`, !/[–—]/.test(handReason(p, false)));
}

const card = readFileSync("app/dashboard/properties/[id]/ads-still-up-card.tsx", "utf8");
ok("card no longer says 'on your own site account'", !card.includes("on your own site account"));
ok("card shows the reason per row", card.includes("handReason(post.portal, stuck.has(post.portal))"));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page passes robotStuck from needs_operator takedowns", /robotStuck=\{runItemRows[\s\S]{0,120}needs_operator/.test(page));
const action = readFileSync("app/dashboard/properties/[id]/ads-still-up-actions.ts", "utf8");
ok("redirect names the post", action.includes("?ad=down&post=${encodeURIComponent(postId)}#ads-still-up"));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
