// S739: properties joins organizations two ways (its own organization_id and
// concierge_leaseup_claims, 0172), so a bare organizations(...) embed on a
// properties query is ambiguous and PostgREST refuses it (PGRST201). The
// results email failed every run from 2026-10-26 18:30Z, and a leased rental's
// renter page never read the account's plan. Every properties query must name
// the link. Run: npx tsx scripts/test-org-embed-hint.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const bad: string[] = [];
for (const file of [...walk("app"), ...walk("lib")]) {
  const src = readFileSync(file, "utf8");
  let i = src.indexOf('.from("properties")');
  while (i >= 0) {
    const end = src.indexOf(";", i);
    const stmt = src.slice(i, end < 0 ? i + 800 : end);
    if (/(^|[^!\w])organizations\(/.test(stmt.replace(/organizations!properties_organization_id_fkey\(/g, ""))) bad.push(file);
    i = src.indexOf('.from("properties")', i + 1);
  }
}
ok("no bare organizations(...) embed on a properties query", bad.length === 0, bad);
ok("results email names the link", readFileSync("app/api/cron/posted-results-email/route.ts", "utf8").includes("organization:organizations!properties_organization_id_fkey("));
ok("renter page names the link", readFileSync("app/r/[propertyId]/page.tsx", "utf8").includes('select("organizations!properties_organization_id_fkey(closed_at, plan)")'));

console.log(`org-embed-hint: ${p} passed, ${f} failed`);
if (f) process.exit(1);
