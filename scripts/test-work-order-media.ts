// Unit tests for the pure work-order-media helpers (S328).
// Run: npx tsx scripts/test-work-order-media.ts
import {
  workOrderMediaStoragePath,
  MAX_PHOTOS_PER_WORK_ORDER,
  MAX_WORK_ORDER_PHOTO_BYTES,
} from "../lib/work-order-media";
import { extFromStoragePath } from "../lib/incident-media";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

const org = "11111111-1111-1111-1111-111111111111";
const wo = "22222222-2222-2222-2222-222222222222";
const media = "33333333-3333-3333-3333-333333333333";
const path = workOrderMediaStoragePath(org, wo, media, "jpg");

// FIRST path segment MUST be the org id — the bucket RLS gates on it.
ok("path starts with org id", path.split("/")[0] === org);
ok("path has work-orders segment", path.split("/")[1] === "work-orders");
ok("path has work order id segment", path.split("/")[2] === wo);
ok("path ends with media id + ext", path.endsWith(`${media}.jpg`));
ok("ext round-trips", extFromStoragePath(path) === "jpg");
ok("png ext respected", workOrderMediaStoragePath(org, wo, media, "png").endsWith(".png"));

// Caps are sane.
ok("photo cap is 10 MB", MAX_WORK_ORDER_PHOTO_BYTES === 10 * 1024 * 1024);
ok("per-WO photo limit positive", MAX_PHOTOS_PER_WORK_ORDER > 0 && MAX_PHOTOS_PER_WORK_ORDER <= 20);

console.log(`\nwork-order-media: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
