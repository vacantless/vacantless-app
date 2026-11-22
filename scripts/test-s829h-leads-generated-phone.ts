// S829h: leads.phone_e164 is a generated column. Any insert that writes it
// fails, which is why "Send to Vacantless" said "Something went wrong and the
// renter was not saved" for a chat with a name and no matched rental.
// Run: npx tsx scripts/test-s829h-leads-generated-phone.ts
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { planSend } from "../lib/send-shortcut";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
// No leads insert or update may set phone_e164.
const offenders: string[] = [];
for (const p of [...files("lib"), ...files("app")]) {
  const s = readFileSync(p, "utf8");
  const re = /\.from\("leads"\)\s*\.(insert|update|upsert)\(([\s\S]*?)\)\s*[.;]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) if (/\bphone_e164\s*:/.test(m[2])) offenders.push(p);
}
ok(() => assert.deepEqual(offenders, []));
// The case from 2026-11-22: a name, no email or phone, rental not matched.
ok(() => assert.deepEqual(planSend({ name: "Koby", email: null, phone: null, rentalId: null }), { kind: "name_no_rental" }));
const server = readFileSync("lib/send-shortcut-server.ts", "utf8");
ok(() => assert.ok(server.includes("[shortcut/renter] save failed:")));
// The key's account first, then the person's other accounts; the renter is
// saved in the account that owns the matched rental.
ok(() => assert.ok(server.includes("const orgIds = await sendOrgIds(admin, owner);")));
ok(() => assert.ok(server.includes("const orgId = (rental && rentalOrg.get(rental.id)) || owner.orgId;")));
ok(() => assert.ok(server.includes('roleCan(m.role, "manage_leads")')));
ok(() => assert.ok(!/organization_id: owner\.orgId/.test(server)));
const route = readFileSync("app/api/shortcut/renter/route.ts", "utf8");
ok(() => assert.ok(route.includes("const orgId = r.orgId ?? owner.owner.orgId;")));
console.log(`test-s829h-leads-generated-phone: ${passed} passed`);
