// One email per batch of crew taps (S803). Run: npx tsx scripts/test-unit-progress-digest.ts
import { readyDigests, digestCountLabel, tapLine, photosAlreadyLine, QUIET_MS } from "../lib/unit-progress-digest";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const now = new Date("2026-11-16T14:10:00Z");
const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60000).toISOString();
const row = (id: string, prop: string, minAgo: number, crew = "x", org = "o") => ({
  id, organizationId: org, crewMemberId: crew, propertyId: prop, line: `${prop} line ${id}`, createdAt: at(minAgo),
});

// still tapping: newest tap 2 minutes ago -> wait
ok("waits while tapping", readyDigests([row("1", "a", 8), row("2", "b", 2)], now).length === 0);
// quiet for 6 minutes -> one batch
const b = readyDigests([row("1", "a", 12), row("2", "b", 9), row("3", "c", 6)], now);
ok("one batch", b.length === 1);
ok("three lines", b[0].lines.length === 3);
ok("all events marked", b[0].eventIds.length === 3);
ok("oldest first", b[0].lines[0] === "a line 1");
// same unit twice -> the later tap only
const d = readyDigests([row("1", "a", 12), row("2", "a", 8)], now);
ok("latest tap per unit", d[0].lines.length === 1 && d[0].lines[0] === "a line 2");
ok("both events cleared", d[0].eventIds.length === 2);
// two crew members -> two batches
ok("per crew member", readyDigests([row("1", "a", 10, "x"), row("2", "b", 10, "y")], now).length === 2);
// two orgs -> two batches
ok("per account", readyDigests([row("1", "a", 10, "x", "o1"), row("2", "b", 10, "x", "o2")], now).length === 2);
// exactly at the quiet edge -> ready
ok("edge ready", readyDigests([{ ...row("1", "a", 0), createdAt: new Date(now.getTime() - QUIET_MS).toISOString() }], now).length === 1);
ok("empty", readyDigests([], now).length === 0);
// wording
ok("count label one", digestCountLabel(1) === "1 unit");
ok("count label many", digestCountLabel(5) === "5 units");
ok("tap line trims address", tapLine("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4", "Photos are in", "") === "833 Pillette Rd, Unit 3: Photos are in.");
ok("tap line extra", tapLine("1 A St, Windsor", "Rented", "Ads coming down.").endsWith("Rented. Ads coming down."));
ok("photos already plural", photosAlreadyLine(14) === "It already has 14 photos, so nothing new was pulled.");
ok("photos already one", photosAlreadyLine(1) === "It already has 1 photo, so nothing new was pulled.");
ok("no em dashes", !/—/.test(tapLine("a", "b", "c") + photosAlreadyLine(2)));

console.log(`unit-progress-digest: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
