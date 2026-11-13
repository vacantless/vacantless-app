// Run with: npx tsx scripts/test-photo-touchup.ts
// S789e: automatic touch-up makes a dim photo brighter without blowing it out, and keeps it a JPEG.
import sharp from "sharp";
import { touchUpPhoto, TOUCHUP } from "../lib/photo-touchup";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

(async () => {
  // A dim, low-contrast "indoor" frame: a grey ramp squeezed into 70..140.
  const w = 300;
  const h = 200;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 70 + Math.round((x / (w - 1)) * 70);
      const i = (y * w + x) * 3;
      raw[i] = v;
      raw[i + 1] = v - 4;
      raw[i + 2] = v - 8;
    }
  }
  const flat = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const before = await sharp(flat).stats();
  const out = await touchUpPhoto(new Uint8Array(flat));
  ok("touch-up returns bytes", !!out && out.byteLength > 0);
  if (out) {
    const meta = await sharp(Buffer.from(out)).metadata();
    ok("still a JPEG, same size", meta.format === "jpeg" && meta.width === w && meta.height === h);
    const after = await sharp(Buffer.from(out)).stats();
    ok("brighter overall", after.channels[0].mean > before.channels[0].mean + 15);
    ok("dark end lifted", after.channels[0].min > before.channels[0].min + 15);
    ok("bright end not blown out", after.channels[0].max < 250);
  }
  ok("junk bytes give null, not a throw", (await touchUpPhoto(new Uint8Array([1, 2, 3, 4]))) === null);
  ok("gentle settings", TOUCHUP.brightness <= 1.1 && TOUCHUP.saturation <= 1.1 && TOUCHUP.jpegQuality >= 80);
  console.log(`photo-touchup: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
