// S818b: an account can send its own application form (Buildium and the like).
// Run: npx tsx scripts/test-s818b-own-application-form.ts
import { readFileSync } from "node:fs";
import { helpVideosFor } from "../lib/page-help";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

const mig = read("supabase/migrations/0309_org_application_link.sql");
ok("0309 columns", mig.includes("application_link_url") && mig.includes("application_link_name"));
ok("org select has columns", read("lib/org.ts").includes("screening_link_name, application_link_url, application_link_name\""));

const srv = read("lib/rental-application-server.ts");
const ext = srv.indexOf("if (args.org.application_link_url)");
const dup = srv.indexOf("One open application per person");
ok("own form branch runs before any Vacantless row", ext > 0 && dup > ext);
ok("own form emails the account's link", srv.slice(ext, dup).includes("apply_url: link"));
ok("own form notes the timeline", srv.slice(ext, dup).includes("application link sent to"));
ok("own form inserts no application row", !srv.slice(ext, dup).includes('from("rental_applications")'));

ok("lead action passes the link", read("app/dashboard/leads/actions.ts").includes("application_link_url: org.application_link_url ?? null"));
ok("lead action ext banners", read("app/dashboard/leads/actions.ts").includes('res.emailed ? "ext_sent" : "ext_copy"'));
ok("agent action reads the link", read("app/agent/[token]/actions.ts").includes("application_link_url, application_link_name"));

const card = read("app/dashboard/leads/[id]/application-card.tsx");
ok("card own form button", card.includes("Send your {p.ownForm.name || \"own\"} application"));
ok("card copy link", card.includes('<CopyTextButton value={p.ownForm.url} label="Copy the link" />'));
ok("card banners", card.includes("ext_sent:") && card.includes("ext_copy:"));
ok("lead page passes ownForm", read("app/dashboard/leads/[id]/page.tsx").includes("ownForm={org?.application_link_url"));

const settings = read("app/dashboard/settings/page.tsx");
ok("settings box", settings.includes('id="application-form"') && settings.includes("updateApplicationLink"));
ok("settings action validates link", read("app/dashboard/settings/actions.ts").includes("export async function updateApplicationLink"));

// "?" help: pages that used to fall back to the full list now open a match.
for (const p of ["/dashboard/people", "/dashboard/people/abc", "/dashboard/numbers", "/dashboard/crew", "/dashboard/settings", "/dashboard/me"]) {
  ok(`help matched ${p}`, helpVideosFor(p).length > 0);
}
ok("notifications still 7", helpVideosFor("/dashboard/settings/notifications")[0]?.n === 7);

console.log(`test-s818b-own-application-form: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
