// Unit tests for the pure incident-media domain model.
// Run: npx tsx scripts/test-incident-media.ts
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_INCIDENT_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_MEDIA_PER_REPORT,
  isAllowedImageType,
  isAllowedVideoType,
  isAllowedMediaType,
  kindForType,
  maxBytesForType,
  isWithinSizeLimit,
  formatBytes,
  validateMediaUpload,
  mediaUploadErrorMessage,
  extForType,
  incidentMediaStoragePath,
  extFromStoragePath,
} from "../lib/incident-media";

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

// --- Type whitelist ---------------------------------------------------------
ok("image types are jpeg/png/webp", ALLOWED_IMAGE_TYPES.length === 3);
ok("video types are mp4/quicktime/webm", ALLOWED_VIDEO_TYPES.length === 3);
ok("combined set = image + video", ALLOWED_INCIDENT_MEDIA_TYPES.length === 6);
ok("isAllowedImageType jpeg", isAllowedImageType("image/jpeg"));
ok("isAllowedImageType rejects gif", !isAllowedImageType("image/gif"));
ok("isAllowedImageType rejects heic", !isAllowedImageType("image/heic"));
ok("isAllowedImageType rejects video", !isAllowedImageType("video/mp4"));
ok("isAllowedVideoType mov(quicktime)", isAllowedVideoType("video/quicktime"));
ok("isAllowedVideoType rejects avi", !isAllowedVideoType("video/x-msvideo"));
ok("isAllowedMediaType true for image", isAllowedMediaType("image/png"));
ok("isAllowedMediaType true for video", isAllowedMediaType("video/webm"));
ok("isAllowedMediaType false for pdf", !isAllowedMediaType("application/pdf"));
ok("isAllowedMediaType false for non-string", !isAllowedMediaType(123));

// --- Kind resolution --------------------------------------------------------
ok("kindForType image", kindForType("image/jpeg") === "image");
ok("kindForType video", kindForType("video/mp4") === "video");
ok("kindForType null for bad", kindForType("image/gif") === null);
ok("kindForType null for undefined", kindForType(undefined) === null);

// --- Per-kind caps ----------------------------------------------------------
ok("image cap 10MB", MAX_IMAGE_BYTES === 10 * 1024 * 1024);
ok("video cap 25MB", MAX_VIDEO_BYTES === 25 * 1024 * 1024);
ok("video cap > image cap (bucket ceiling)", MAX_VIDEO_BYTES > MAX_IMAGE_BYTES);
ok("maxBytesForType image", maxBytesForType("image/png") === MAX_IMAGE_BYTES);
ok("maxBytesForType video", maxBytesForType("video/quicktime") === MAX_VIDEO_BYTES);

ok("isWithinSizeLimit image ok", isWithinSizeLimit(5 * 1024 * 1024, "image/jpeg"));
ok("isWithinSizeLimit image over", !isWithinSizeLimit(11 * 1024 * 1024, "image/jpeg"));
ok("isWithinSizeLimit video ok", isWithinSizeLimit(20 * 1024 * 1024, "video/mp4"));
ok("isWithinSizeLimit video over", !isWithinSizeLimit(26 * 1024 * 1024, "video/mp4"));
ok("isWithinSizeLimit zero", !isWithinSizeLimit(0, "image/jpeg"));
ok("isWithinSizeLimit non-number", !isWithinSizeLimit("5" as unknown, "image/jpeg"));
// a 20MB image is fine for video but NOT for an image — cap is per-kind
ok("20MB rejected as image", !isWithinSizeLimit(20 * 1024 * 1024, "image/png"));

// --- formatBytes ------------------------------------------------------------
ok("formatBytes 10MB", formatBytes(10 * 1024 * 1024) === "10 MB");
ok("formatBytes 25MB", formatBytes(25 * 1024 * 1024) === "25 MB");
ok("formatBytes KB", formatBytes(2048) === "2 KB");
ok("formatBytes bytes", formatBytes(512) === "512 B");

// --- validateMediaUpload ----------------------------------------------------
const vImg = validateMediaUpload({ type: "image/jpeg", size: 4 * 1024 * 1024 });
ok("valid image -> ok+kind", vImg.ok === true && vImg.ok && vImg.kind === "image");
const vVid = validateMediaUpload({ type: "video/quicktime", size: 20 * 1024 * 1024 });
ok("valid video -> ok+kind", vVid.ok === true && vVid.ok && vVid.kind === "video");
ok("empty file -> empty", validateMediaUpload({ type: "image/jpeg", size: 0 }).ok === false &&
  (validateMediaUpload({ type: "image/jpeg", size: 0 }) as { reason: string }).reason === "empty");
ok("bad type -> type", (validateMediaUpload({ type: "image/heic", size: 100 }) as { reason: string }).reason === "type");
ok("oversize image -> size", (validateMediaUpload({ type: "image/png", size: 11 * 1024 * 1024 }) as { reason: string }).reason === "size");
ok("oversize video -> size", (validateMediaUpload({ type: "video/mp4", size: 30 * 1024 * 1024 }) as { reason: string }).reason === "size");
ok("missing size -> empty", validateMediaUpload({ type: "image/jpeg" }).ok === false);

// --- error copy -------------------------------------------------------------
ok("error type mentions photo+video", /photo/i.test(mediaUploadErrorMessage("type")) && /video/i.test(mediaUploadErrorMessage("type")));
ok("error size mentions both caps", /10 MB/.test(mediaUploadErrorMessage("size")) && /25 MB/.test(mediaUploadErrorMessage("size")));
ok("error empty", /empty/i.test(mediaUploadErrorMessage("empty")));

// --- extForType -------------------------------------------------------------
ok("ext jpeg->jpg", extForType("image/jpeg") === "jpg");
ok("ext png", extForType("image/png") === "png");
ok("ext webp", extForType("image/webp") === "webp");
ok("ext mp4", extForType("video/mp4") === "mp4");
ok("ext quicktime->mov", extForType("video/quicktime") === "mov");
ok("ext webm", extForType("video/webm") === "webm");
ok("ext unknown->bin", extForType("application/zip") === "bin");

// --- storage path -----------------------------------------------------------
const path = incidentMediaStoragePath("org-1", "rep-9", "media-7", "mov");
ok("path layout org/report/media.ext", path === "org-1/rep-9/media-7.mov");
ok("path first segment is org (storage RLS gate)", path.split("/")[0] === "org-1");
ok("extFromStoragePath mov", extFromStoragePath(path) === "mov");
ok("extFromStoragePath jpg", extFromStoragePath("a/b/c.JPG") === "jpg");
ok("extFromStoragePath no-ext -> bin", extFromStoragePath("a/b/c") === "bin");

// --- misc -------------------------------------------------------------------
ok("media-per-report cap is sane", MAX_MEDIA_PER_REPORT >= 1 && MAX_MEDIA_PER_REPORT <= 50);

console.log(`\nincident-media: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
