// S712: building photos (shared with units of the same building that have none).
// Run: npx tsx scripts/test-building-photos.ts
import { readFileSync } from "node:fs";
import { buildingKey } from "../lib/booking";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("units of one building share a key", buildingKey("833 Pillette Rd, Unit 3, Windsor") === buildingKey("833 Pillette Rd Unit 33, Windsor"));
ok("different buildings differ", buildingKey("833 Pillette Rd") !== buildingKey("1195 Bruce Ave"));

const lib = readFileSync("lib/building-photos-server.ts", "utf8");
ok("never touches a unit that has photos", lib.includes("if ((count ?? 0) > 0) return 0;"));
ok("only originals are shared, never copies of copies", lib.includes('.is("copied_from", null)'));
ok("org-scoped", lib.includes('.eq("organization_id", orgId)') && lib.includes('.eq("organization_id", input.orgId)'));
ok("first copy becomes the cover", lib.includes("is_cover: i === 0"));

const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("delete keeps a file another unit still shows", actions.includes("if (target && !fileStillUsed) {"));
ok("new units start with building photos (create paths)", (actions.match(/copyBuildingPhotosTo\(supabase/g) ?? []).length >= 2);
ok("mark is org-scoped", actions.includes('.update({ building_photo: on })'));
const mgr = readFileSync("app/dashboard/properties/[id]/photo-manager.tsx", "utf8");
ok("copies cannot be re-shared", mgr.includes("{!photo.copied_from && ("));
ok("badge says where it came from", mgr.includes('"From the building"'));

console.log(`\nbuilding-photos: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
