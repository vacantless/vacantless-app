// Focused tests for the direct-to-storage property photo upload path.
// Run: npx tsx scripts/test-property-photo-upload.ts
import { readFileSync } from "node:fs";
import {
  MAX_PHOTO_BYTES,
  coverAfterDelete,
  normalizeConfirmedPhotoUploads,
  parsePhotoStoragePath,
  planPhotoDirectUploads,
  reorder,
  sortPhotos,
  type PhotoLike,
} from "../lib/photos";

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

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const OTHER_PROPERTY = "44444444-4444-4444-8444-444444444444";
const PHOTO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHOTO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHOTO_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// --- signed-upload planning ------------------------------------------------
{
  let n = 0;
  const ids = [PHOTO_A, PHOTO_B];
  const plan = planPhotoDirectUploads({
    orgId: ORG,
    propertyId: PROPERTY,
    files: [
      { name: " Kitchen.jpg ", type: "image/jpeg", sizeBytes: 1_000 },
      { name: "living.webp", type: "image/webp", sizeBytes: 2_000 },
    ],
    existingRows: [{ sort_order: 4 }],
    photoCap: 24,
    createId: () => ids[n++],
  });
  ok("plan: accepts valid files", plan.ok);
  if (plan.ok) {
    ok("plan: trims display name", plan.uploads[0].name === "Kitchen.jpg");
    ok(
      "plan: org/property scoped path",
      plan.uploads[0].storagePath === `${ORG}/${PROPERTY}/${PHOTO_A}.jpg`,
    );
    ok("plan: appends sort order", plan.uploads[0].order === 5);
    ok("plan: preserves file order", plan.uploads[1].order === 6);
  }
}
ok(
  "plan: rejects empty",
  !planPhotoDirectUploads({
    orgId: ORG,
    propertyId: PROPERTY,
    files: [],
    existingRows: [],
    photoCap: 24,
    createId: () => PHOTO_A,
  }).ok,
);
{
  const plan = planPhotoDirectUploads({
    orgId: ORG,
    propertyId: PROPERTY,
    files: [{ name: "x.heic", type: "image/heic", sizeBytes: 1_000 }],
    existingRows: [],
    photoCap: 24,
    createId: () => PHOTO_A,
  });
  ok("plan: rejects unsupported type", !plan.ok && plan.reason === "type");
}
{
  const plan = planPhotoDirectUploads({
    orgId: ORG,
    propertyId: PROPERTY,
    files: [{ name: "x.jpg", type: "image/jpeg", sizeBytes: MAX_PHOTO_BYTES + 1 }],
    existingRows: [],
    photoCap: 24,
    createId: () => PHOTO_A,
  });
  ok("plan: rejects over 10MB", !plan.ok && plan.reason === "size");
}
{
  const plan = planPhotoDirectUploads({
    orgId: ORG,
    propertyId: PROPERTY,
    files: [{ name: "x.jpg", type: "image/jpeg", sizeBytes: 1 }],
    existingRows: Array.from({ length: 24 }, (_, i) => ({ sort_order: i })),
    photoCap: 24,
    createId: () => PHOTO_A,
  });
  ok("plan: enforces property photo cap", !plan.ok && plan.reason === "max");
}

// --- confirmation path normalization --------------------------------------
{
  const parsed = parsePhotoStoragePath(`${ORG}/${PROPERTY}/${PHOTO_A}.jpg`, ORG, PROPERTY);
  ok("parse path: accepts scoped jpg", parsed.ok && parsed.photoId === PHOTO_A);
  ok(
    "parse path: rejects cross-org",
    !parsePhotoStoragePath(`${OTHER_ORG}/${PROPERTY}/${PHOTO_A}.jpg`, ORG, PROPERTY).ok,
  );
  ok(
    "parse path: rejects cross-property",
    !parsePhotoStoragePath(`${ORG}/${OTHER_PROPERTY}/${PHOTO_A}.jpg`, ORG, PROPERTY).ok,
  );
  ok(
    "parse path: rejects unsupported extension",
    !parsePhotoStoragePath(`${ORG}/${PROPERTY}/${PHOTO_A}.heic`, ORG, PROPERTY).ok,
  );
  ok(
    "parse path: rejects non-uuid filename",
    !parsePhotoStoragePath(`${ORG}/${PROPERTY}/not-a-uuid.jpg`, ORG, PROPERTY).ok,
  );
}
{
  const normalized = normalizeConfirmedPhotoUploads(
    [
      { storagePath: `${ORG}/${PROPERTY}/${PHOTO_B}.webp`, order: 2 },
      { storagePath: `${ORG}/${PROPERTY}/${PHOTO_A}.jpg`, order: 1 },
      { storagePath: `${ORG}/${PROPERTY}/${PHOTO_A}.jpg`, order: 1 },
      { storagePath: `${ORG}/${PROPERTY}/${PHOTO_C}.png`, order: 3 },
    ],
    ORG,
    PROPERTY,
  );
  ok("confirm: accepts valid uploaded paths", normalized.ok);
  if (normalized.ok) {
    ok("confirm: de-dupes duplicate paths", normalized.uploads.length === 3);
    ok("confirm: sorts by upload order", normalized.uploads[0].photoId === PHOTO_A);
    ok("confirm: extracts final photo id", normalized.uploads[2].photoId === PHOTO_C);
  }
}
{
  const normalized = normalizeConfirmedPhotoUploads(
    [{ storagePath: `${ORG}/${OTHER_PROPERTY}/${PHOTO_A}.jpg`, order: 1 }],
    ORG,
    PROPERTY,
  );
  ok("confirm: rejects uploaded path outside property", !normalized.ok && normalized.reason === "path");
}

// --- optimistic grid helpers ----------------------------------------------
{
  const photos: PhotoLike[] = [
    { id: "a", sort_order: 0, is_cover: true },
    { id: "b", sort_order: 1, is_cover: false },
    { id: "c", sort_order: 2, is_cover: false },
  ];

  const nextOrder = reorder(photos, "c", "up");
  const orderById = new Map(nextOrder.map((p) => [p.id, p.sort_order]));
  const moved = sortPhotos(
    photos.map((photo) => ({
      ...photo,
      sort_order: orderById.get(photo.id) ?? photo.sort_order,
    })),
  );
  ok("optimistic move: updates display order immediately", moved.map((p) => p.id).join(",") === "a,c,b");

  const covered = sortPhotos(
    photos.map((photo) => ({
      ...photo,
      is_cover: photo.id === "c",
    })),
  );
  ok("optimistic cover: selected photo becomes first", covered.map((p) => p.id).join(",") === "c,a,b");

  const promoteId = coverAfterDelete(photos, "a");
  const deleted = sortPhotos(
    photos
      .filter((photo) => photo.id !== "a")
      .map((photo) =>
        promoteId && photo.id === promoteId
          ? { ...photo, is_cover: true }
          : photo,
      ),
  );
  ok("optimistic delete: removes and promotes cover", deleted.map((p) => p.id).join(",") === "b,c");
}

// --- server-action source contract ----------------------------------------
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok(
  "actions: direct target action exported",
  actions.includes("export async function createPhotoUploadTargets"),
);
ok(
  "actions: confirm action exported",
  actions.includes("export async function confirmPropertyPhotos"),
);
ok(
  "actions: shared auth requires manage_properties",
  actions.includes('requireCapability("manage_properties", "/dashboard/properties?forbidden=1")'),
);
ok(
  "actions: shared auth binds property to active org",
  actions.includes('.from("properties")') &&
    actions.includes('.eq("organization_id", org.id)'),
);
ok(
  "actions: target action mints signed upload URLs",
  actions.includes(".createSignedUploadUrl(upload.storagePath)"),
);
ok(
  "actions: confirm checks object exists before row insert",
  actions.includes(".exists(upload.storagePath)"),
);
ok(
  "actions: confirm writes property_photos rows",
  actions.includes('.from("property_photos").insert({') &&
    actions.includes("storage_path: upload.storagePath") &&
    actions.includes("url: publicUrl") &&
    actions.includes("is_cover: firstEver"),
);
ok(
  "actions: confirm returns refreshed photo rows",
  actions.includes("photos: await loadPropertyPhotoViews(supabase, propertyId)"),
);
ok(
  "actions: delete/move/cover no longer redirect to static photo URLs",
  !actions.includes("photos=removed") &&
    !actions.includes("photos=order") &&
    !actions.includes("photos=cover"),
);
ok(
  "actions: delete/move/cover still revalidate the property page",
  actions.includes("export async function setCoverPhoto") &&
    actions.includes("export async function movePhoto") &&
    actions.includes("export async function deletePhoto") &&
    actions.includes("revalidatePath(`/dashboard/properties/${propertyId}`);"),
);

// --- client optimistic action contract -------------------------------------
const manager = readFileSync(
  "app/dashboard/properties/[id]/photo-manager.tsx",
  "utf8",
);
ok(
  "photo manager: imports useEffect for server-action refresh sync",
  manager.includes("useEffect, useRef, useState"),
);
ok(
  "photo manager: syncs local grid from refreshed initialPhotos",
  manager.includes("useEffect(() => {") &&
    manager.includes("setPhotos(initialPhotos);") &&
    manager.includes("}, [initialPhotos]);"),
);
ok(
  "photo manager: imports optimistic photo helpers",
  manager.includes("coverAfterDelete,") &&
    manager.includes("reorder,") &&
    manager.includes("sortPhotos,"),
);
ok(
  "photo manager: has client handlers for the stale-grid actions",
  manager.includes("async function handleMovePhoto") &&
    manager.includes("async function handleSetCoverPhoto") &&
    manager.includes("async function handleDeletePhoto"),
);
ok(
  "photo manager: optimistically updates local photos",
  manager.includes("setPhotos((current) => {") &&
    manager.includes("setPhotos((current) =>") &&
    manager.includes("setPhotos(before);"),
);
ok(
  "photo manager: persists through the existing server actions",
  manager.includes("await movePhoto(formDataForPhoto(photoId, direction));") &&
    manager.includes("await setCoverPhoto(formDataForPhoto(photoId));") &&
    manager.includes("await deletePhoto(formDataForPhoto(photoId));"),
);
ok(
  "photo manager: refreshes after persisted photo actions",
  (manager.match(/router\.refresh\(\);/g) ?? []).length >= 4,
);
ok(
  "photo manager: no stale server-action forms for grid actions",
  !manager.includes("action={movePhoto}") &&
    !manager.includes("action={setCoverPhoto}") &&
    !manager.includes("action={deletePhoto}"),
);

console.log(`\nproperty-photo-upload: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
