// S832c: dark or blurry photo flag, and touch-up on uploads.
// Run: npx tsx scripts/test-s832c-photo-quality.ts
import { readFileSync } from "node:fs";
import { QUALITY, photoQualityFlag, photoQualityLabel, photoQualityLine, photoQualityMetrics } from "../lib/photo-quality";

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// Synthetic frames, 64 x 64.
const W = 64;
const H = 64;
function frame(fn: (x: number, y: number) => number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.max(0, Math.min(255, Math.round(fn(x, y))));
  return a;
}
// A bright room with sharp edges: a checker of 8 px tiles.
const sharpBright = frame((x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 220 : 120));
// The same, smooth: a gentle ramp, no edges.
const smoothBright = frame((x) => 150 + x);
// Dark everywhere, with edges.
const darkSharp = frame((x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 90 : 20));
// A dark door with a bright wall beside it (most of the frame dark).
const darkDoor = frame((x, y) => (x < 48 ? 30 + ((y % 8) < 1 ? 40 : 0) : 230));

const mSharp = photoQualityMetrics(sharpBright, W, H);
ok("sharp bright: no flag", photoQualityFlag(mSharp) === null, mSharp);
ok("smooth bright: blurry", photoQualityFlag(photoQualityMetrics(smoothBright, W, H)) === "blurry");
ok("dark with edges: dark", photoQualityFlag(photoQualityMetrics(darkSharp, W, H)) === "dark");
ok("dark smooth: both", photoQualityFlag(photoQualityMetrics(frame(() => 40), W, H)) === "dark_blurry");
const mDoor = photoQualityMetrics(darkDoor, W, H);
ok("dark door beside a bright wall: not dark (p95 rule)", photoQualityFlag(mDoor) !== "dark" && photoQualityFlag(mDoor) !== "dark_blurry", mDoor);
ok("thresholds as calibrated", QUALITY.darkP95Below === 110 && QUALITY.blurLapVarBelow === 60 && QUALITY.longSide === 512);

ok("labels", photoQualityLabel("dark") === "Looks dark" && photoQualityLabel("blurry") === "Looks blurry" && photoQualityLabel(null) === null);
ok("no line when all fine", photoQualityLine([null, null], false) === null);
const line1 = photoQualityLine(["dark", null], true) ?? "";
ok("one-photo line names the cover", line1.startsWith("1 photo looks dark or blurry") && line1.includes("cover photo"));
ok("line has no em dash", !line1.includes("—"));
ok("two-photo line", (photoQualityLine(["dark", "blurry"], false) ?? "").startsWith("2 photos look"));

// Wiring.
const actions = read("app/dashboard/properties/actions.ts");
ok("upload confirm takes the brighten switch", actions.includes("opts?: { touchUp?: boolean }") && actions.includes("touchUp: opts?.touchUp === true"));
ok("upload insert saves the flag and the kept original", actions.includes("quality_flag: qualityFlag") && actions.includes("original_storage_path: touched.originalStoragePath"));
const mgr = read("app/dashboard/properties/[id]/photo-manager.tsx");
ok("upload box has Brighten, on by default", mgr.includes("useState(true)") && mgr.includes("Brighten these photos") && mgr.includes("{ touchUp: brighten }"));
ok("photo list shows the flag", mgr.includes("photoQualityLabel(photo.quality_flag)") && mgr.includes("photoQualityLine("));
ok("drive pull checks quality", read("lib/drive-import-server.ts").includes("quality_flag: await assessPhotoQuality("));
ok("dropbox pull checks quality", read("lib/dropbox-import-server.ts").includes("quality_flag: await assessPhotoQuality("));
ok("migration 0323", read("supabase/migrations/0323_photo_quality_flag.sql").includes("add column if not exists quality_flag"));
ok("touched path beside the upload", read("lib/photo-touchup-upload-server.ts").includes("`${photoId}-touched`, \"jpg\""));
ok("folder box no longer says uploads are left alone", !read("app/dashboard/properties/[id]/page.tsx").includes("Photos you upload yourself are left as they are"));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
