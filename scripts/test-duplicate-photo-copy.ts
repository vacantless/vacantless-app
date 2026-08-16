// Regression coverage for duplicate-a-listing photo copies and storage-prefix
// guardrails. Run: npx tsx scripts/test-duplicate-photo-copy.ts
import fs from "node:fs";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const actions = fs.readFileSync("app/dashboard/properties/actions.ts", "utf8");
const page = fs.readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
const photos = fs.readFileSync("lib/photos.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/0215_property_photos_storage_prefix_guard.sql",
  "utf8",
);
const qaSeed = fs.readFileSync("scripts/seed-codex-qa-northstar.sql", "utf8");
const rehomeScript = fs.readFileSync("scripts/rehome-property-photo-prefixes.mjs", "utf8");

ok(
  "duplicate copy imports the admin client",
  actions.includes('import { createAdminClient } from "@/lib/supabase/admin";'),
);
ok(
  "duplicate copy tries service-role storage before user storage",
  actions.includes("const adminForCopy = createAdminClient();") &&
    actions.includes("const storageClients = adminForCopy ? [adminForCopy, supabase] : [supabase];") &&
    actions.includes("for (const storageClient of storageClients)") &&
    actions.includes("await storageClient.storage"),
);
ok(
  "duplicate copy logs copy failures with both paths",
  actions.includes('console.error("duplicateProperty: photo copy failed"') &&
    actions.includes("fromPath: c.fromPath") &&
    actions.includes("toPath: c.toPath") &&
    actions.includes("error: copyErr.message"),
);
ok(
  "duplicate copy reports real cloned count in redirect",
  actions.includes('new URLSearchParams({ duplicated: String(clonedCount) })') &&
    actions.includes("cloneParams.set(\"photoerr\", clonePhotoError)") &&
    actions.includes("cloneParams.set(\"photosource\", String(sourcePhotos.length))"),
);
ok(
  "photos_ready still requires every source photo to copy",
  actions.includes("clonedCount > 0 && clonedCount === sourcePhotos.length && s.photos_ready"),
);
ok(
  "photoCloneResultParam distinguishes no source, zero-copy, and partial",
  photos.includes("export function photoCloneResultParam(") &&
    photos.includes('return "copy0";') &&
    photos.includes('return "copypartial";'),
);
ok(
  "page warns for duplicate zero-copy and partial-copy",
  page.includes('searchParams.photoerr === "copy0"') &&
    page.includes('searchParams.photoerr === "copypartial"') &&
    page.includes("No photos copied from the source rental") &&
    page.includes("Review the photo set before publishing"),
);
ok(
  "generic upload error excludes duplicate clone warnings",
  page.includes('searchParams.photoerr !== "copy0"') &&
    page.includes('searchParams.photoerr !== "copypartial"'),
);
ok(
  "migration installs a trigger on property_photos",
  migration.includes("create trigger property_photos_storage_prefix_guard") &&
    migration.includes("before insert or update of property_id, organization_id, storage_path") &&
    migration.includes("execute function public.enforce_property_photo_storage_prefix()"),
);
ok(
  "migration rejects row-org mismatch",
  migration.includes("new.organization_id is distinct from v_property_org") &&
    migration.includes("property_photos.organization_id must match property organization_id"),
);
ok(
  "migration rejects storage prefix mismatch",
  migration.includes("split_part(coalesce(new.storage_path, ''), '/', 1)") &&
    migration.includes("v_storage_org <> v_property_org::text") &&
    migration.includes("property_photos.storage_path prefix must match property organization_id"),
);
ok(
  "QA seed no longer uses the literal seed prefix",
  !qaSeed.includes("'seed/833-pillette/") &&
    qaSeed.includes(
      "'b733a191-30fd-47fe-bd21-731404148026/11111111-1111-4111-8111-111111111101/living.jpg'",
    ),
);
ok(
  "rehome script preflights table update before storage copy",
  rehomeScript.includes("update privilege preflight failed before storage copy") &&
    rehomeScript.indexOf("await preflightUpdatePrivilege(row)") <
      rehomeScript.indexOf("await ensureCopied(row, toPath)"),
);

console.log(`\nduplicate-photo-copy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
