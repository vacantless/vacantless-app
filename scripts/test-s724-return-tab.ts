// S724 (V251-42): a save returns to the tab you were on. Run: npx tsx scripts/test-s724-return-tab.ts
import { readFileSync } from "node:fs";
import { tabFromReferer } from "../lib/return-tab";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }
const id = "db7d147e-cf0b-4339-a52a-abc8a5b92825";
ok("tab kept", tabFromReferer(`https://app.vacantless.com/dashboard/properties/${id}?tab=market&saved=1`, id) === "market");
ok("no tab", tabFromReferer(`https://app.vacantless.com/dashboard/properties/${id}`, id) === null);
ok("other rental ignored", tabFromReferer(`https://app.vacantless.com/dashboard/properties/other?tab=market`, id) === null);
ok("junk ignored", tabFromReferer(`https://app.vacantless.com/dashboard/properties/${id}?tab=%3Cscript%3E`, id) === null);
ok("no referer", tabFromReferer(null, id) === null);
const tabs = readFileSync("app/dashboard/properties/[id]/tabbed-sections.tsx", "utf8");
ok("tab bar writes ?tab=", /searchParams\.set\("tab", tabId\)/.test(tabs) && /onClick=\{\(\) => pickTab\(tabId\)\}/.test(tabs));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("save redirect carries the tab", /returnTab \? `&tab=\$\{returnTab\}` : ""/.test(actions));
console.log(`s724-return-tab: ${p} passed, ${f} failed`);
if (f) process.exit(1);
