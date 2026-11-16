// S802 (REVIEW-S799 item 18): which accounts are ours. Run: npx tsx scripts/test-own-accounts.ts
import assert from "node:assert/strict";
import { ownOrgIds } from "../lib/new-account-watch";
import { QUIET_NOTIFICATION_ORGANIZATION_IDS, isQuietNotificationOrg } from "../lib/quiet-orgs";

let n = 0;
function ok(name: string, fn: () => void) { fn(); n++; console.log("ok", name); }

// The accounts as they stood on 2026-11-15 [verified via Supabase SQL].
const AGILE = "921f7c08-98af-428f-a238-36f4a781b0de";
const MAPLE = "a0e2e45c-f2be-427e-b8db-30535a821daa";
const PAUL = "ee112b4d-49f1-4b07-bcf9-04d3c7c2876c";
const S799 = "f06d6b49-b9b3-416d-b52b-11ac11f92584";
const NORTH = "b733a191-30fd-47fe-bd21-731404148026";
const emails = new Map<string, (string | null)[]>([
  [AGILE, ["rentals@agileonline.ca", "thadmusco@gmail.com"]],
  [MAPLE, []],
  [PAUL, ["peretzschwartz@gmail.com"]],
  [S799, ["noammuscovitch+s799@gmail.com"]],
  [NORTH, ["nmuscovitch+vacantlessfresh0617@hotmail.com"]],
]);
const listed = new Set<string>(QUIET_NOTIFICATION_ORGANIZATION_IDS);
const ours = ownOrgIds([AGILE, MAPLE, PAUL, S799, NORTH], emails, listed);

ok("Agile and Paul Peretz are real customers", () => {
  assert.ok(!ours.has(AGILE));
  assert.ok(!ours.has(PAUL));
});
ok("Maple Door is ours though it has no login (listed, Noam confirmed S802)", () => {
  assert.ok(ours.has(MAPLE));
  assert.ok(isQuietNotificationOrg(MAPLE));
});
ok("an unlisted account with no login is not assumed ours", () => {
  assert.ok(!ownOrgIds(["x"], new Map([["x", []]]), new Set()).has("x"));
});
ok("stranger walks and QA accounts are ours by address", () => {
  assert.ok(ours.has(S799));
  assert.ok(ours.has(NORTH));
});
ok("Agile is never on the quiet list", () => assert.ok(!listed.has(AGILE)));
console.log(`\n${n} passed`);
