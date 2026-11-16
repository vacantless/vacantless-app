// Linking a folder on a rental that already has its photos (S803).
// Run: npx tsx scripts/test-photo-baseline.ts
import { drivePullLine, markedLine, mergeSeenRefs, pullResultFromParam, pullResultParam } from "../lib/drive-import";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const marked = { ok: true as const, added: 0, skipped: 0, alreadyIn: 14, marked: 14 };
ok("param", pullResultParam(marked) === "marked_14");
const back = pullResultFromParam("marked_14");
ok("param round trip", !!back && back.ok && back.marked === 14 && back.added === 0);
ok("line from result", drivePullLine(marked) === markedLine(14));
ok("line plural", markedLine(14) === "Folder linked. Its 14 photos are counted as already on the rental, so only new ones pull in.");
ok("line one", markedLine(1) === "Folder linked. Its 1 photo is counted as already on the rental, so only new ones pull in.");
ok("line empty folder", markedLine(0) === "Folder linked. New photos added to it will pull in.");
ok("added still works", pullResultParam({ ok: true, added: 3, skipped: 0, alreadyIn: 0 }) === "added_3");
ok("bad param", pullResultFromParam("marked_x") === null);
ok("merge dedupes", mergeSeenRefs(["a", "b"], ["b", "c"]).join() === "a,b,c");
ok("merge from nothing", mergeSeenRefs(null, ["a"]).join() === "a");
ok("merge caps, keeps newest", mergeSeenRefs(["a", "b"], ["c"], 2).join() === "b,c");
ok("no em dashes", !/—/.test(markedLine(0) + markedLine(3)));

console.log(`photo-baseline: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
