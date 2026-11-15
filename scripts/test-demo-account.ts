// Demo account (S800): the demo login may read four pages and write nothing.
// Run: npx tsx scripts/test-demo-account.ts
import {
  DEMO_ORG_ID,
  demoDecision,
  demoEmail,
  isDemoEmail,
  maskEmail,
  maskPhone,
  scrubContactText,
  isPrefetch,
} from "../lib/demo-account";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const ID = "1ed3b06e-9022-43c9-9716-cbadc951140f";

// --- who is the demo login ---
ok("not configured -> no demo email", demoEmail({}) === null);
ok("blank -> no demo email", demoEmail({ DEMO_ACCOUNT_EMAIL: "  " }) === null);
ok("no @ -> no demo email", demoEmail({ DEMO_ACCOUNT_EMAIL: "demo" }) === null);
ok("configured address read lower-cased", demoEmail({ DEMO_ACCOUNT_EMAIL: " Demo@Vacantless.com " }) === "demo@vacantless.com");
ok("same address matches in any case", isDemoEmail("DEMO@vacantless.com", "demo@vacantless.com"));
ok("another login is not the demo", !isDemoEmail("noam@royallepage.ca", "demo@vacantless.com"));
ok("nothing configured -> nobody is the demo", !isDemoEmail("demo@vacantless.com", null));
ok("no login -> not the demo", !isDemoEmail(null, "demo@vacantless.com"));
ok("demo account is Lakeview Rentals", DEMO_ORG_ID === "b6fdceb7-e7f6-4f54-bbab-107ae5d3254a");

// --- writes: every non-GET is refused, on every path ---
const paths = [
  "/dashboard",
  "/dashboard/properties",
  `/dashboard/properties/${ID}`,
  `/dashboard/leads/${ID}`,
  "/dashboard/settings",
  "/dashboard/billing",
  "/api/anything",
  "/demo",
  "/",
  "/signup",
];
for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
  for (const p of paths) {
    ok(`${method} ${p} is refused`, demoDecision({ method, pathname: p }).kind === "deny");
  }
}

// --- reads: four pages open ---
for (const p of [
  "/dashboard",
  "/dashboard/",
  "/dashboard/properties",
  `/dashboard/properties/${ID}`,
  "/dashboard/leads",
  `/dashboard/leads/${ID}`,
  "/dashboard/showings",
]) {
  ok(`GET ${p} is open`, demoDecision({ method: "GET", pathname: p }).kind === "allow");
  ok(`HEAD ${p} is open`, demoDecision({ method: "HEAD", pathname: p }).kind === "allow");
}

// --- reads: everything else in the account goes back to Today ---
for (const p of [
  "/dashboard/settings",
  "/dashboard/billing",
  "/dashboard/money",
  "/dashboard/tenants",
  "/dashboard/tenancies/abc",
  "/dashboard/maintenance",
  "/dashboard/me",
  "/dashboard/admin",
  "/dashboard/properties/new",
  "/dashboard/properties/import",
  `/dashboard/properties/${ID}/edit`,
  `/dashboard/leads/${ID}/application/print`,
  "/dashboard/leads/not-an-id",
  "/dashboard/reports",
  "/dashboard/crew",
  "/dashboard/sites",
  "/onboarding",
  "/agent",
  "/admin",
]) {
  const d = demoDecision({ method: "GET", pathname: p });
  ok(`GET ${p} goes back to Today`, d.kind === "redirect" && d.to === "/dashboard");
}
ok("GET /api is refused", demoDecision({ method: "GET", pathname: "/api/cron/rent-stop" }).kind === "deny");
ok("GET /apiary is not the api (public page rule)", demoDecision({ method: "GET", pathname: "/apiary" }).kind === "allow");

// --- public pages stay open for a read ---
for (const p of ["/", "/pricing", "/login", "/signup", "/demo/exit", `/r/${ID}`]) {
  ok(`GET ${p} is open`, demoDecision({ method: "GET", pathname: p }).kind === "allow");
}

// --- masking: nothing of the owner's shows ---
const own = "nmuscovitch+demo724@hotmail.com";
const m = maskEmail(own) ?? "";
ok("email masked", m === "n***@example.com");
ok("masked email has no owner address", !/nmuscovitch|hotmail/i.test(m));
ok("empty email stays empty", maskEmail("") === null && maskEmail(null) === null);
ok("phone masked to last four", maskPhone("519-555-0724") === "***-***-0724");
ok("empty phone stays empty", maskPhone(null) === null);
const text = `Hi Sarah, we wrote to ${own} and ${own}. Call 519-555-0724 or (226) 555-0718 or 1-416-555-0721.`;
const scrubbed = scrubContactText(text) ?? "";
ok("scrub removes the email", !/nmuscovitch|hotmail/i.test(scrubbed));
ok("scrub removes the numbers", !/519-555-0724|226\) 555-0718|416-555-0721/.test(scrubbed));
ok("scrub keeps the sentence", scrubbed.startsWith("Hi Sarah, we wrote to"));
ok("scrub of null is null", scrubContactText(null) === null);

// --- S800b: a prefetch never signs the demo out ---
const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
ok("Next router prefetch is a prefetch", isPrefetch(h({ "next-router-prefetch": "1" })));
ok("RSC fetch is a prefetch", isPrefetch(h({ rsc: "1" })));
ok("Purpose: prefetch is a prefetch", isPrefetch(h({ purpose: "prefetch" })));
ok("Sec-Purpose: prefetch;prerender is a prefetch", isPrefetch(h({ "sec-purpose": "prefetch;prerender" })));
ok("a plain click is not a prefetch", !isPrefetch(h({})));
{
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
  ok("Leave the demo is not a Next Link", !/<Link[^>]*\/demo\/exit/.test(layout));
  const exit = readFileSync("app/demo/exit/route.ts", "utf8");
  ok("exit route checks for a prefetch first", exit.indexOf("isPrefetch(") > -1 && exit.indexOf("isPrefetch(") < exit.indexOf("signOut("));
}

console.log(`\ntest-demo-account: ${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
