// S827a: the Rentals list says which rental is missing which site, and every
// "needs you" signal can be clicked. Source-level guard on the list page.
import { readFileSync } from "node:fs";
import { todoSummary } from "../lib/rental-list-view";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL", name);
  }
}

const src = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok(src.includes("const gapItems ="), "gap items are built from coverage rows");
ok(src.includes(": not on {g.sites.join(\", \")} yet. Post it"), "banner names the rental and its missing sites");
ok(src.includes("?tab=distribute#distribute-header`}"), "banner links go to the rental's posting section");
ok(src.includes("href={headline.needYou > 0 && firstNeedId ? `#rental-${firstNeedId}` : undefined}"), "Need you tile links to the first rental that needs you");
ok(src.includes("id={`rental-${p.id}`}"), "each row has an anchor");
ok(src.includes("+ Post to {l.label}"), "the Marketplace gap chip reads as an action");
ok(!src.includes("text-gray-400 transition hover:border-gray-400 hover:text-gray-600\"\n                              >\n                                + {l.label}"), "the Marketplace gap chip is no longer greyed out");
ok(!/""\}Each one is marked on its row\./.test(src), "the old dead-end line is gone");
ok(todoSummary(1, 0) === "1 rental is missing a site", "headline count unchanged");
ok(!/(not on|Show me|Post to)[^\n]*\u2014/.test(src), "no em dashes in the new copy");

console.log(`test-s827a-gap-links: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
