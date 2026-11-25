// S839a: resized public rental photos (lib/photo-size.ts) and the wiring.
// Run: npx tsx scripts/test-s839-photo-size.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sizedPhotoUrl, PHOTO_WIDTH_COVER, PHOTO_WIDTH_THUMB, PHOTO_WIDTH_FULL } from "../lib/photo-size";

const ours =
  "https://nvhvdyxpyogvadpjlvij.supabase.co/storage/v1/object/public/property-photos/org/rental/photo.jpg";

assert.equal(
  sizedPhotoUrl(ours, 1280),
  "https://nvhvdyxpyogvadpjlvij.supabase.co/storage/v1/render/image/public/property-photos/org/rental/photo.jpg?width=1280&quality=75&resize=contain",
);
assert.ok(sizedPhotoUrl(ours, 480).endsWith("?width=480&quality=70&resize=contain"));
assert.ok(sizedPhotoUrl(ours, 9000).includes("width=2500"), "width is capped");
assert.ok(sizedPhotoUrl(ours.replace(".jpg", ".PNG"), 480).includes("/render/image/"));

// Anything that is not one of our public rental photos is left alone.
for (const other of [
  "https://example.com/storage/v1/object/public/property-photos/a.jpg",
  "https://nvhvdyxpyogvadpjlvij.supabase.co/storage/v1/object/public/documents/a.jpg",
  "https://nvhvdyxpyogvadpjlvij.supabase.co/storage/v1/object/sign/property-photos/a.jpg",
  ours + "?v=2",
  ours.replace(".jpg", ".heic"),
  ours.replace("https://", "http://"),
  "",
]) {
  assert.equal(sizedPhotoUrl(other, 480), other);
}
assert.equal(sizedPhotoUrl(ours, 0), ours);
assert.equal(sizedPhotoUrl(ours, Number.NaN), ours);

assert.ok(PHOTO_WIDTH_THUMB < PHOTO_WIDTH_COVER && PHOTO_WIDTH_COVER < PHOTO_WIDTH_FULL);

// Wiring: the public gallery asks for sized photos, lazy-loads the grid and
// falls back to the original if the resized copy fails.
const gallery = readFileSync("app/r/[propertyId]/photo-gallery.tsx", "utf8");
assert.ok(gallery.includes("sizedPhotoUrl(cover, PHOTO_WIDTH_COVER)"));
assert.ok(gallery.includes("sizedPhotoUrl(url, PHOTO_WIDTH_THUMB)"));
assert.ok(gallery.includes("sizedPhotoUrl(photos[open], PHOTO_WIDTH_FULL)"));
assert.ok(gallery.includes('loading="lazy"'));
assert.ok((gallery.match(/onError=\{showOriginal\(/g) ?? []).length === 3, "all three images fall back");

// The dashboard shows a loading screen at once, and the server runs beside the database.
const loading = readFileSync("app/dashboard/loading.tsx", "utf8");
assert.ok(loading.includes('aria-busy="true"'));
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
assert.deepEqual(vercel.regions, ["yul1"]);
assert.equal(vercel.crons.length, 2, "crons kept (S841c's /warm removed in S841g)");

// S839b: a loading screen at the top only shows when the top section changes.
// A link inside a section (Rentals list to one rental) needs one in that section.
for (const dir of ["properties", "tenancies", "tenancies/[id]", "leads", "maintenance", "settings", "reports", "money", "rent"]) {
  const inner = readFileSync(`app/dashboard/${dir}/loading.tsx`, "utf8");
  assert.ok(inner.includes('from "@/app/dashboard/loading"'), dir);
}

console.log("test-s839-photo-size: ok");
