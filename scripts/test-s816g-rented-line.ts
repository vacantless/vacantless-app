// S816g: the Rented email says what really happened to the ads.
// Run: npx tsx scripts/test-s816g-rented-line.ts
import { readFileSync } from "node:fs";
import { rentedLine } from "../lib/unit-progress";
let failed = 0;
const ok = (n: string, c: boolean) => { if (!c) { failed++; console.error("FAIL:", n); } };
ok("no ads", rentedLine(0).startsWith("It had no ads up") && !rentedLine(0).includes("coming down"));
ok("one ad", rentedLine(1).startsWith("Its ad is coming down."));
ok("three ads", rentedLine(3).startsWith("Its 3 ads are coming down."));
ok("unknown", rentedLine(undefined).startsWith("Its ads are coming down."));
ok("undo line", rentedLine(0).endsWith("relist it from the rental page."));
ok("no em dash", ![0, 1, 3, undefined].some((n) => rentedLine(n as number | undefined).includes("—")));
const server = readFileSync("lib/unit-progress-server.ts", "utf8");
ok("counted before takedown", server.indexOf("liveAds = count") < server.indexOf("await markRentedAndTakeDown({"));
console.log(failed ? `${failed} failed` : "rented-line: all passed");
if (failed) process.exit(1);
