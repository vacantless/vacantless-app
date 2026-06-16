// Unit tests for the pure photo logic. Run: npx tsx scripts/test-photos.ts
import {
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_PROPERTY,
  isAllowedPhotoType,
  isWithinSizeLimit,
  formatBytes,
  validatePhotoUpload,
  uploadErrorMessage,
  extForType,
  photoStoragePath,
  sortPhotos,
  nextSortOrder,
  reorder,
  withCover,
  coverAfterDelete,
  type PhotoLike,
} from "../lib/photos";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- types -----------------------------------------------------------------
ok("ALLOWED_PHOTO_TYPES has 4", ALLOWED_PHOTO_TYPES.length === 4);
ok("isAllowedPhotoType: jpeg", isAllowedPhotoType("image/jpeg"));
ok("isAllowedPhotoType: png", isAllowedPhotoType("image/png"));
ok("isAllowedPhotoType: webp", isAllowedPhotoType("image/webp"));
ok("isAllowedPhotoType: gif", isAllowedPhotoType("image/gif"));
ok("isAllowedPhotoType: rejects heic", !isAllowedPhotoType("image/heic"));
ok("isAllowedPhotoType: rejects pdf", !isAllowedPhotoType("application/pdf"));
ok("isAllowedPhotoType: rejects non-string", !isAllowedPhotoType(null));

// --- size ------------------------------------------------------------------
ok("MAX_PHOTO_BYTES is 10MB", MAX_PHOTO_BYTES === 10 * 1024 * 1024);
ok("isWithinSizeLimit: 1MB ok", isWithinSizeLimit(1024 * 1024));
ok("isWithinSizeLimit: exactly max ok", isWithinSizeLimit(MAX_PHOTO_BYTES));
ok("isWithinSizeLimit: over max rejected", !isWithinSizeLimit(MAX_PHOTO_BYTES + 1));
ok("isWithinSizeLimit: zero rejected", !isWithinSizeLimit(0));
ok("isWithinSizeLimit: negative rejected", !isWithinSizeLimit(-5));
ok("isWithinSizeLimit: non-number rejected", !isWithinSizeLimit("100" as unknown));

// --- formatBytes -----------------------------------------------------------
ok("formatBytes: 10MB", formatBytes(10 * 1024 * 1024) === "10 MB");
ok("formatBytes: 1.5MB", formatBytes(1.5 * 1024 * 1024) === "1.5 MB");
ok("formatBytes: KB", formatBytes(2048) === "2 KB");
ok("formatBytes: bytes", formatBytes(512) === "512 B");

// --- validatePhotoUpload ---------------------------------------------------
ok(
  "validate: good jpeg",
  validatePhotoUpload({ type: "image/jpeg", size: 500_000 }).ok === true,
);
{
  const r = validatePhotoUpload({ type: "image/heic", size: 500_000 });
  ok("validate: bad type -> reason type", !r.ok && r.reason === "type");
}
{
  const r = validatePhotoUpload({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 });
  ok("validate: too big -> reason size", !r.ok && r.reason === "size");
}
{
  const r = validatePhotoUpload({ type: "image/jpeg", size: 0 });
  ok("validate: empty -> reason empty", !r.ok && r.reason === "empty");
}
ok(
  "uploadErrorMessage: type mentions formats",
  uploadErrorMessage("type").includes("JPG"),
);
ok(
  "uploadErrorMessage: size mentions 10 MB",
  uploadErrorMessage("size").includes("10 MB"),
);
ok("uploadErrorMessage: empty", uploadErrorMessage("empty").length > 0);
ok("MAX_PHOTOS_PER_PROPERTY positive", MAX_PHOTOS_PER_PROPERTY > 0);

// --- extForType / paths ----------------------------------------------------
ok("extForType: jpeg -> jpg", extForType("image/jpeg") === "jpg");
ok("extForType: png", extForType("image/png") === "png");
ok("extForType: webp", extForType("image/webp") === "webp");
ok("extForType: gif", extForType("image/gif") === "gif");
ok("extForType: unknown -> bin", extForType("image/heic") === "bin");
ok(
  "photoStoragePath: org-first then property then id.ext",
  photoStoragePath("ORG", "PROP", "PHOTO", "jpg") === "ORG/PROP/PHOTO.jpg",
);

// --- sortPhotos ------------------------------------------------------------
{
  const photos: PhotoLike[] = [
    { id: "b", sort_order: 1, is_cover: false },
    { id: "c", sort_order: 2, is_cover: true },
    { id: "a", sort_order: 0, is_cover: false },
  ];
  const sorted = sortPhotos(photos);
  ok("sortPhotos: cover first", sorted[0].id === "c");
  ok("sortPhotos: then by sort_order", sorted[1].id === "a" && sorted[2].id === "b");
}

// --- nextSortOrder ---------------------------------------------------------
ok("nextSortOrder: empty -> 0", nextSortOrder([]) === 0);
ok(
  "nextSortOrder: max+1",
  nextSortOrder([{ sort_order: 0 }, { sort_order: 3 }, { sort_order: 1 }]) === 4,
);

// --- reorder ---------------------------------------------------------------
{
  const photos: PhotoLike[] = [
    { id: "a", sort_order: 0, is_cover: false },
    { id: "b", sort_order: 1, is_cover: true },
    { id: "c", sort_order: 2, is_cover: false },
  ];
  const up = reorder(photos, "c", "up"); // c moves above b
  const orderUp = up.sort((x, y) => x.sort_order - y.sort_order).map((p) => p.id);
  ok("reorder up: a,c,b", orderUp.join(",") === "a,c,b");
  ok("reorder: dense 0..n", up.every((p, i) => up.find((q) => q.sort_order === i)));

  const down = reorder(photos, "a", "down"); // a moves below b
  const orderDown = down.sort((x, y) => x.sort_order - y.sort_order).map((p) => p.id);
  ok("reorder down: b,a,c", orderDown.join(",") === "b,a,c");

  const edge = reorder(photos, "a", "up"); // already first -> no move
  const orderEdge = edge.sort((x, y) => x.sort_order - y.sort_order).map((p) => p.id);
  ok("reorder up at edge: unchanged a,b,c", orderEdge.join(",") === "a,b,c");

  const missing = reorder(photos, "zzz", "up");
  ok("reorder missing id: unchanged order", missing.length === 3);

  // Cover should NOT pin position: reordering ignores is_cover.
  ok(
    "reorder ignores cover (b stays middle-ish)",
    reorder(photos, "b", "down").find((p) => p.id === "b")!.sort_order === 2,
  );
}

// --- withCover -------------------------------------------------------------
{
  const photos: PhotoLike[] = [
    { id: "a", sort_order: 0, is_cover: true },
    { id: "b", sort_order: 1, is_cover: false },
    { id: "c", sort_order: 2, is_cover: false },
  ];
  const changes = withCover(photos, "b");
  ok("withCover: two changes", changes.length === 2);
  ok(
    "withCover: b->true",
    changes.find((c) => c.id === "b")?.is_cover === true,
  );
  ok(
    "withCover: a->false",
    changes.find((c) => c.id === "a")?.is_cover === false,
  );
  ok("withCover: c untouched", !changes.some((c) => c.id === "c"));
  ok("withCover: already cover -> no change", withCover(photos, "a").length === 0);
  ok("withCover: missing id -> []", withCover(photos, "zzz").length === 0);
}

// --- coverAfterDelete ------------------------------------------------------
{
  const photos: PhotoLike[] = [
    { id: "a", sort_order: 0, is_cover: true },
    { id: "b", sort_order: 1, is_cover: false },
    { id: "c", sort_order: 2, is_cover: false },
  ];
  ok("coverAfterDelete: delete cover -> promote b", coverAfterDelete(photos, "a") === "b");
  ok("coverAfterDelete: delete non-cover -> null", coverAfterDelete(photos, "b") === null);
  ok(
    "coverAfterDelete: delete last cover -> null",
    coverAfterDelete([{ id: "a", sort_order: 0, is_cover: true }], "a") === null,
  );
  ok("coverAfterDelete: missing id -> null", coverAfterDelete(photos, "zzz") === null);
}

// --- summary ---------------------------------------------------------------
console.log(`\nphotos: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
