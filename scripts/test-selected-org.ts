// Unit tests for the selected-org validation logic (Tier 1 B).
// Run: npx tsx scripts/test-selected-org.ts
import { validateSelectedOrg } from "../lib/selected-org";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

ok("cookie in membership set -> that org", validateSelectedOrg(B, [A, B]) === B);
ok("cookie NOT in membership set -> first membership", validateSelectedOrg(C, [A, B]) === A);
ok("unset cookie (null) -> first membership", validateSelectedOrg(null, [A, B]) === A);
ok("unset cookie (undefined) -> first membership", validateSelectedOrg(undefined, [A, B]) === A);
ok("empty string cookie -> first membership", validateSelectedOrg("", [A, B]) === A);
ok("empty membership set -> null", validateSelectedOrg(A, []) === null);
ok("single-org user, no cookie -> their org (unaffected)", validateSelectedOrg(null, [A]) === A);
ok("single-org user, cookie = their org -> their org", validateSelectedOrg(A, [A]) === A);
ok("single-org user, stale cookie for another org -> their org", validateSelectedOrg(B, [A]) === A);

console.log(
  `\ntest-selected-org: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
