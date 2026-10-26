// scripts/test-s724-posting-stop.ts. Run: tsx scripts/test-s724-posting-stop.ts
import { siteSetupNotice } from "@/lib/distribution-publish";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.error("FAIL", n, g ?? ""); } }
const n = siteSetupNotice("needs_operator", "free_limit_reached");
ok("free limit notice", !!n && n.href.includes("rentals.ca") && n.message.includes("free ads"), n);
ok("not on other statuses", siteSetupNotice("queued", "free_limit_reached") === null);
ok("no em dash", !n?.message.includes("—"));
// S738: shared Rentals.ca account.
const sh = siteSetupNotice("needs_operator", "account_shared");
ok("shared account notice", !!sh && sh.href === "/dashboard/site-signin/rentals_ca" && /only you use/.test(sh.message), sh);
ok("shared notice no em dash", !sh?.message.includes("\u2014"));
console.log(`s724-posting-stop: ${p} passed, ${f} failed`);
if (f) process.exit(1);
