// S712i: the Free plan's one-live-rental cap holds on every path that can make
// a rental Live. Run: npx tsx scripts/test-live-cap-every-path.ts
import { readFileSync } from "node:fs";
import { listingCapForPlan, overListingCapNotice } from "../lib/billing";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("free cap is one", listingCapForPlan("free") === 1);
ok("unknown plan gets the free cap", listingCapForPlan(null) === 1);
ok("growth has no cap", listingCapForPlan("growth") === null);
ok("notice over cap", (overListingCapNotice("free", 3) ?? "").includes("3 live rentals"));
ok("no notice within cap", overListingCapNotice("free", 1) === null);

const a = readFileSync("app/dashboard/properties/actions.ts", "utf8");
function body(name: string): string {
  const i = a.indexOf(`export async function ${name}(`);
  const j = a.indexOf("\nexport async function ", i + 10);
  return i < 0 ? "" : a.slice(i, j < 0 ? undefined : j);
}
ok("helper exists", a.includes("async function liveRentalCapFull("));
ok("publish checks the cap", body("publishProperty").includes("liveRentalCapFull("));
ok("edit form Status checks the cap", body("updateProperty").includes("liveRentalCapFull("));
ok("edit form keeps prior status when blocked", body("updateProperty").includes("capBlocked = true"));
ok("edit form tells the landlord", body("updateProperty").includes("publish=plan"));
ok("relist checks the cap before updating", (() => {
  const b = body("relistLeasedProperty");
  return b.indexOf("liveRentalCapFull(") > 0 && b.indexOf("liveRentalCapFull(") < b.indexOf('.update({ status: "available" })');
})());
ok("unarchive checks the cap", body("unarchiveProperty").includes("liveRentalCapFull("));
ok("unarchive over cap restores as paused", body("unarchiveProperty").includes('restore.status = "paused"'));
const list = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok("list explains a paused restore", list.includes('searchParams.restored === "paused"'));

console.log(`\nlive-cap-every-path: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
