// scripts/test-s724-reply-link.ts. Run: tsx scripts/test-s724-reply-link.ts
import { buildReplyDraft } from "@/lib/lead-detail";
import { friendlyDate } from "@/lib/ai-reply";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) pass++; else { fail++; console.error("FAIL", n, g ?? ""); } }
const lead = { name: "James Park", property: { address: "100 Lakeview Ave, Windsor, ON" } };
const a = buildReplyDraft(lead, "Lakeview Rentals", "https://app.vacantless.com/r/abc");
ok("link in basic draft", a.body.includes("pick a time here: https://app.vacantless.com/r/abc"), a.body);
const b = buildReplyDraft(lead, "Lakeview Rentals");
ok("no link when none", !b.body.includes("http") && b.body.includes("Reply here"), b.body);
ok("friendly Nov 1", friendlyDate("2026-11-01") === "Nov 1");
ok("friendly passthrough", friendlyDate("ASAP") === "ASAP");
ok("friendly null", friendlyDate(null) === null);
console.log(`s724-reply-link: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
