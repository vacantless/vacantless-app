// Unit tests for the pure logo-upload logic. Run: npx tsx scripts/test-logo.ts
import {
  ALLOWED_LOGO_TYPES,
  MAX_LOGO_BYTES,
  isAllowedLogoType,
  isWithinLogoSize,
  validateLogoUpload,
  logoUploadErrorMessage,
  extForLogoType,
  logoStoragePath,
} from "../lib/logo";

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

// --- allowed types ---------------------------------------------------------
ok("ALLOWED_LOGO_TYPES has 5", ALLOWED_LOGO_TYPES.length === 5);
ok("isAllowedLogoType: png", isAllowedLogoType("image/png"));
ok("isAllowedLogoType: jpeg", isAllowedLogoType("image/jpeg"));
ok("isAllowedLogoType: webp", isAllowedLogoType("image/webp"));
ok("isAllowedLogoType: gif", isAllowedLogoType("image/gif"));
ok("isAllowedLogoType: svg", isAllowedLogoType("image/svg+xml"));
ok("isAllowedLogoType: rejects heic", !isAllowedLogoType("image/heic"));
ok("isAllowedLogoType: rejects pdf", !isAllowedLogoType("application/pdf"));
ok("isAllowedLogoType: rejects null", !isAllowedLogoType(null));
ok("isAllowedLogoType: rejects number", !isAllowedLogoType(7 as unknown));

// --- size ------------------------------------------------------------------
ok("MAX_LOGO_BYTES is 2 MB", MAX_LOGO_BYTES === 2 * 1024 * 1024);
ok("isWithinLogoSize: 1 MB ok", isWithinLogoSize(1024 * 1024));
ok("isWithinLogoSize: exactly max ok", isWithinLogoSize(MAX_LOGO_BYTES));
ok("isWithinLogoSize: over max no", !isWithinLogoSize(MAX_LOGO_BYTES + 1));
ok("isWithinLogoSize: zero no", !isWithinLogoSize(0));
ok("isWithinLogoSize: negative no", !isWithinLogoSize(-5));
ok("isWithinLogoSize: non-number no", !isWithinLogoSize("100" as unknown));

// --- validateLogoUpload ----------------------------------------------------
ok("validate: good png", validateLogoUpload({ type: "image/png", size: 5000 }).ok);
ok("validate: good svg", validateLogoUpload({ type: "image/svg+xml", size: 5000 }).ok);
{
  const r = validateLogoUpload({ type: "image/png", size: 0 });
  ok("validate: empty -> reason empty", !r.ok && r.reason === "empty");
}
{
  const r = validateLogoUpload({ type: "image/heic", size: 5000 });
  ok("validate: bad type -> reason type", !r.ok && r.reason === "type");
}
{
  const r = validateLogoUpload({ type: "image/png", size: MAX_LOGO_BYTES + 1 });
  ok("validate: too big -> reason size", !r.ok && r.reason === "size");
}
// empty is checked before type so a 0-byte unknown-type file reads as "empty"
{
  const r = validateLogoUpload({ type: "application/pdf", size: 0 });
  ok("validate: 0-byte unknown -> empty first", !r.ok && r.reason === "empty");
}

// --- error messages --------------------------------------------------------
ok("msg empty", logoUploadErrorMessage("empty").length > 0);
ok("msg type", logoUploadErrorMessage("type").length > 0);
ok("msg size mentions 2 MB", logoUploadErrorMessage("size").includes("2 MB"));
ok("msg empty no em dash", !logoUploadErrorMessage("empty").includes("—"));
ok("msg type no em dash", !logoUploadErrorMessage("type").includes("—"));
ok("msg size no em dash", !logoUploadErrorMessage("size").includes("—"));

// --- extForLogoType --------------------------------------------------------
ok("ext png", extForLogoType("image/png") === "png");
ok("ext jpeg -> jpg", extForLogoType("image/jpeg") === "jpg");
ok("ext webp", extForLogoType("image/webp") === "webp");
ok("ext gif", extForLogoType("image/gif") === "gif");
ok("ext svg", extForLogoType("image/svg+xml") === "svg");
ok("ext unknown -> bin", extForLogoType("application/octet-stream") === "bin");

// --- logoStoragePath -------------------------------------------------------
ok(
  "path is org-first",
  logoStoragePath("org-1", "file-9", "png") === "org-1/file-9.png",
);
ok(
  "path first segment is the org id",
  logoStoragePath("ORG", "F", "svg").split("/")[0] === "ORG",
);

// --- summary ---------------------------------------------------------------
console.log(`\nlogo: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
