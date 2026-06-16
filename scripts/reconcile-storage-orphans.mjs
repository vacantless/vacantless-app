// ============================================================================
// Storage orphan reconcile — the B4 backstop (S203).
//
// Sweeps the property-photos and org-logos buckets for objects that have no
// matching database reference (a property_photos.storage_path, or an
// organizations.logo_url), i.e. files that were left behind when a delete
// failed to free the underlying object. The primary cause was the missing
// authenticated SELECT policy on storage.objects (fixed in migration 0025);
// this script is the last-resort cleanup for anything that slipped through.
//
// SAFE BY DEFAULT:
//   * Dry-run unless you pass --apply (prints what it WOULD remove).
//   * Age-gated: ignores objects newer than --min-age-minutes (default 60) so
//     it never races an in-flight upload (the upload writes the object, then
//     inserts the row a beat later).
//   * Service-role client (bypasses RLS); remove() still goes through the
//     Storage API so the S3 blob is actually freed.
//
// Run (dry-run):  node --env-file=.env.local scripts/reconcile-storage-orphans.mjs
// Run (apply):    node --env-file=.env.local scripts/reconcile-storage-orphans.mjs --apply
// Options:        --min-age-minutes=N   (default 60)
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const minAgeArg = process.argv.find((a) => a.startsWith("--min-age-minutes="));
const MIN_AGE_MIN = minAgeArg ? Number(minAgeArg.split("=")[1]) : 60;
const cutoff = Date.now() - MIN_AGE_MIN * 60_000;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Recursively walk a bucket and return every object's { name, created_at }.
// Supabase storage.list() returns one directory level at a time; a "folder"
// entry has a null id. Path convention is org/(property)/file, so we recurse.
async function walk(bucket, prefix = "") {
  const out = [];
  const { data, error } = await admin.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) {
    console.error(`list ${bucket}/${prefix} failed: ${error.message}`);
    return out;
  }
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // a folder — recurse
      out.push(...(await walk(bucket, full)));
    } else if (entry.name === ".emptyFolderPlaceholder") {
      // Supabase's dashboard auto-creates a 0-byte placeholder to keep an
      // emptied folder visible in the UI. Not a real object — never an orphan.
      continue;
    } else {
      out.push({ name: full, created_at: entry.created_at });
    }
  }
  return out;
}

function olderThanCutoff(obj) {
  if (!obj.created_at) return false; // unknown age -> never auto-remove
  return new Date(obj.created_at).getTime() < cutoff;
}

async function removeAll(bucket, names) {
  // remove() takes up to 1000 paths per call
  for (let i = 0; i < names.length; i += 1000) {
    const batch = names.slice(i, i + 1000);
    const { data, error } = await admin.storage.from(bucket).remove(batch);
    if (error) {
      console.error(`  remove failed: ${error.message}`);
    } else {
      console.log(`  removed ${data?.length ?? 0} object(s)`);
    }
  }
}

async function reconcilePhotos() {
  console.log("\n== property-photos ==");
  const { data: rows, error } = await admin
    .from("property_photos")
    .select("storage_path");
  if (error) {
    console.error(`query property_photos failed: ${error.message}`);
    return [];
  }
  const valid = new Set((rows ?? []).map((r) => r.storage_path));
  const objects = await walk("property-photos");
  const orphans = objects.filter((o) => !valid.has(o.name));
  return classify(orphans);
}

async function reconcileLogos() {
  console.log("\n== org-logos ==");
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("logo_url");
  if (error) {
    console.error(`query organizations failed: ${error.message}`);
    return [];
  }
  // org-logos keeps exactly one current object per org; the public URL ends in
  // the object path, so an object is valid only if some org's logo_url ends
  // with that path.
  const urls = (orgs ?? []).map((o) => o.logo_url).filter(Boolean);
  const objects = await walk("org-logos");
  const orphans = objects.filter((o) => !urls.some((u) => u.endsWith(o.name)));
  return classify(orphans);
}

function classify(orphans) {
  const removable = [];
  for (const o of orphans) {
    if (olderThanCutoff(o)) {
      console.log(`  ORPHAN (removable): ${o.name}  [${o.created_at}]`);
      removable.push(o.name);
    } else {
      console.log(
        `  orphan but too new (skip, <${MIN_AGE_MIN}m): ${o.name}  [${o.created_at}]`,
      );
    }
  }
  if (orphans.length === 0) console.log("  no orphans");
  return removable;
}

const photoOrphans = await reconcilePhotos();
if (APPLY && photoOrphans.length) await removeAll("property-photos", photoOrphans);

const logoOrphans = await reconcileLogos();
if (APPLY && logoOrphans.length) await removeAll("org-logos", logoOrphans);

const total = photoOrphans.length + logoOrphans.length;
console.log(
  `\n${APPLY ? "APPLIED" : "DRY-RUN"} — ${total} removable orphan(s) (>${MIN_AGE_MIN}m old).` +
    (APPLY ? "" : " Re-run with --apply to delete them."),
);
