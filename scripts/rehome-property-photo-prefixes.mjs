// ============================================================================
// Re-home property photo rows whose storage_path prefix disagrees with the
// owning property's organization.
//
// SAFE BY DEFAULT:
//   * Dry-run unless --apply is passed.
//   * Only handles the known S660 mismatch groups; unexpected groups fail apply.
//   * Copies/uploads to <owning_org>/<property_id>/<filename>, verifies the
//     destination object is non-zero, and never deletes the old object.
//   * Uses service-role Supabase credentials; do not print env values.
//
// Run (dry-run):
//   node --env-file=.env.local scripts/rehome-property-photo-prefixes.mjs
// Run (apply):
//   node --env-file=.env.local scripts/rehome-property-photo-prefixes.mjs --apply
//
// Needs: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY.
// The service_role DB role must also have update privilege on property_photos;
// --apply preflights that before any storage copy.
// ============================================================================

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "property-photos";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");
const SUMMARY = process.argv.includes("--summary");

if (!URL || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TARGETS = [
  {
    key: "glenrose-unit-4",
    label: "50 Glenrose Ave Unit 4",
    orgPrefix: "b2cb4eab",
    addressIncludes: "50 glenrose",
    unit: "4",
  },
  {
    key: "glenrose-unit-5",
    label: "50 Glenrose Ave Unit 5",
    orgPrefix: "b2cb4eab",
    addressIncludes: "50 glenrose",
    unit: "5",
  },
  {
    key: "growth-pillette-unit-3",
    label: "833 Pillette Rd Unit 3",
    orgPrefix: "8ea1da48",
    addressIncludes: "833 pillette",
    unit: "3",
  },
  {
    key: "qa-pillette-seed",
    label: "833 Pillette QA seed",
    orgPrefix: "b733a191",
    addressIncludes: "833 pillette",
    sourcePrefix: "seed",
    seedUrlUpload: true,
  },
];

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storagePrefix(path) {
  return String(path ?? "").split("/")[0] ?? "";
}

function basename(path) {
  const clean = String(path ?? "").split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function hasUnit(address, unit) {
  if (!unit) return true;
  const n = norm(address);
  const token = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:unit|suite|apt|#)\\s*${token}\\b`).test(n);
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function mimeForPath(path) {
  const ext = basename(path).toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

async function fetchAll(table, select) {
  const out = [];
  const limit = 1000;
  for (let from = 0; ; from += limit) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .range(from, from + limit - 1);
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < limit) break;
  }
  return out;
}

async function loadAuditRows() {
  const [photos, properties, orgs] = await Promise.all([
    fetchAll(
      "property_photos",
      "id, organization_id, property_id, storage_path, url, sort_order, is_cover",
    ),
    fetchAll("properties", "id, organization_id, address, status"),
    fetchAll("organizations", "id, name"),
  ]);
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  return photos.map((photo) => {
    const property = propertyById.get(photo.property_id) ?? null;
    const owningOrgId = property?.organization_id ?? null;
    const rowOrgMismatch = Boolean(
      owningOrgId && photo.organization_id !== owningOrgId,
    );
    const pathPrefix = storagePrefix(photo.storage_path);
    const pathPrefixMismatch = Boolean(owningOrgId && pathPrefix !== owningOrgId);
    return {
      photo,
      property,
      org: owningOrgId ? orgById.get(owningOrgId) ?? null : null,
      owningOrgId,
      pathPrefix,
      rowOrgMismatch,
      pathPrefixMismatch,
      mismatched: !property || rowOrgMismatch || pathPrefixMismatch,
    };
  });
}

function targetFor(row) {
  const property = row.property;
  if (!property || !row.owningOrgId) return null;
  return (
    TARGETS.find((target) => {
      if (!row.owningOrgId.startsWith(target.orgPrefix)) return false;
      if (!norm(property.address).includes(target.addressIncludes)) return false;
      if (!hasUnit(property.address, target.unit)) return false;
      if (target.sourcePrefix && row.pathPrefix !== target.sourcePrefix) return false;
      return true;
    }) ?? null
  );
}

function groupRows(rows) {
  const groups = new Map();
  const unexpected = [];
  for (const row of rows.filter((r) => r.mismatched)) {
    const target = targetFor(row);
    if (!target) {
      unexpected.push(row);
      continue;
    }
    const key = `${target.key}:${row.photo.property_id}`;
    if (!groups.has(key)) groups.set(key, { target, property: row.property, rows: [] });
    groups.get(key).rows.push(row);
  }
  return { groups: Array.from(groups.values()), unexpected };
}

async function downloadObject(path) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "download returned no data" };
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return { ok: true, buffer, size: buffer.length, sha256: hash(buffer) };
}

async function ensureCopied(row, toPath) {
  const source = await downloadObject(row.photo.storage_path);
  if (!source.ok) {
    throw new Error(`download source failed: ${row.photo.storage_path}: ${source.error}`);
  }
  if (source.size <= 0) {
    throw new Error(`source object is empty: ${row.photo.storage_path}`);
  }

  const existing = await downloadObject(toPath);
  if (existing.ok) {
    if (existing.size !== source.size || existing.sha256 !== source.sha256) {
      throw new Error(`destination exists with different bytes: ${toPath}`);
    }
    return { kind: "already-present", size: existing.size };
  }

  const { error } = await admin.storage
    .from(BUCKET)
    .copy(row.photo.storage_path, toPath);
  if (error) throw new Error(`copy failed: ${error.message}`);

  const dest = await downloadObject(toPath);
  if (!dest.ok) throw new Error(`download copied destination failed: ${dest.error}`);
  if (dest.size <= 0) throw new Error(`copied destination is empty: ${toPath}`);
  if (dest.size !== source.size || dest.sha256 !== source.sha256) {
    throw new Error(`copied destination bytes differ: ${toPath}`);
  }
  return { kind: "copied", size: dest.size };
}

async function ensureUploadedFromUrl(row, toPath) {
  if (!row.photo.url) throw new Error(`seed row has no URL: ${row.photo.id}`);
  const res = await fetch(row.photo.url);
  if (!res.ok) throw new Error(`fetch seed URL failed ${res.status}: ${row.photo.url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length <= 0) throw new Error(`seed URL returned empty body: ${row.photo.url}`);

  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || mimeForPath(toPath);
  const existing = await downloadObject(toPath);
  if (existing.ok) {
    if (existing.size !== buffer.length || existing.sha256 !== hash(buffer)) {
      throw new Error(`seed destination exists with different bytes: ${toPath}`);
    }
    return { kind: "already-present", size: existing.size };
  }

  const { error } = await admin.storage.from(BUCKET).upload(toPath, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`seed upload failed: ${error.message}`);

  const dest = await downloadObject(toPath);
  if (!dest.ok) throw new Error(`download seed destination failed: ${dest.error}`);
  if (dest.size <= 0) throw new Error(`seed destination is empty: ${toPath}`);
  return { kind: "uploaded-from-url", size: dest.size };
}

function targetPathFor(row) {
  const file = basename(row.photo.storage_path);
  if (!file) throw new Error(`storage_path has no filename: ${row.photo.storage_path}`);
  return `${row.owningOrgId}/${row.photo.property_id}/${file}`;
}

async function updatePhotoRow(row, toPath) {
  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(toPath);
  const { error } = await admin
    .from("property_photos")
    .update({
      organization_id: row.owningOrgId,
      storage_path: toPath,
      url: publicUrl,
    })
    .eq("id", row.photo.id)
    .eq("storage_path", row.photo.storage_path);
  if (error) throw new Error(`row update failed: ${error.message}`);
  return publicUrl;
}

function printUnexpected(rows) {
  if (rows.length === 0) return;
  console.error("\nUnexpected mismatch groups:");
  for (const row of rows) {
    console.error(
      `  photo=${row.photo.id} property=${row.photo.property_id} org=${row.owningOrgId ?? "missing"} ` +
        `prefix=${row.pathPrefix} address=${row.property?.address ?? "missing property"}`,
    );
  }
}

async function verifyPublicListing(group) {
  const { data, error } = await admin.rpc("get_public_listing", {
    p_property_id: group.property.id,
  });
  if (error) throw new Error(`get_public_listing failed: ${error.message}`);
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  if (photos.length < group.rows.length) {
    throw new Error(
      `public listing returned ${photos.length} photos, expected at least ${group.rows.length}`,
    );
  }
  for (const url of photos.slice(0, group.rows.length)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`public photo fetch failed ${res.status}: ${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length <= 0) throw new Error(`public photo fetched empty: ${url}`);
  }
  return photos.length;
}

console.log(`${APPLY ? "APPLY" : "DRY-RUN"} property photo prefix re-home`);

const auditRows = await loadAuditRows();
const { groups, unexpected } = groupRows(auditRows);
printUnexpected(unexpected);
if (APPLY && unexpected.length > 0) {
  console.error("Refusing to apply with unexpected mismatch rows present.");
  process.exit(1);
}

const orderedGroups = [];
for (const target of TARGETS) {
  orderedGroups.push(...groups.filter((group) => group.target.key === target.key));
}

if (SUMMARY) {
  const total = orderedGroups.reduce((sum, group) => sum + group.rows.length, 0);
  console.log(`SUMMARY total_known_mismatches=${total} unexpected=${unexpected.length}`);
  for (const group of orderedGroups) {
    console.log(
      `  ${group.target.label}: rows=${group.rows.length} property=${group.property.id} org=${group.property.organization_id}`,
    );
  }
  process.exit(unexpected.length > 0 ? 1 : 0);
}

if (orderedGroups.length === 0 && unexpected.length === 0) {
  console.log("No property photo prefix mismatches found.");
}

let copied = 0;
let uploaded = 0;
let alreadyPresent = 0;
let updated = 0;
let updatePreflightDone = false;

async function preflightUpdatePrivilege(row) {
  if (updatePreflightDone) return;
  const { error } = await admin
    .from("property_photos")
    .update({ sort_order: row.photo.sort_order })
    .eq("id", row.photo.id);
  if (error) {
    throw new Error(
      `update privilege preflight failed before storage copy: ${error.message}`,
    );
  }
  updatePreflightDone = true;
}

for (const group of orderedGroups) {
  group.rows.sort((a, b) => {
    const order = a.photo.sort_order - b.photo.sort_order;
    if (order !== 0) return order;
    return String(a.photo.id).localeCompare(String(b.photo.id));
  });
  console.log(
    `\n${group.target.label}: ${group.rows.length} row(s), property=${group.property.id}, org=${group.property.organization_id}`,
  );
  const plannedPaths = new Set();
  for (const row of group.rows) {
    const toPath = targetPathFor(row);
    if (plannedPaths.has(toPath)) {
      throw new Error(`duplicate planned destination path: ${toPath}`);
    }
    plannedPaths.add(toPath);
    console.log(`  ${row.photo.storage_path} -> ${toPath}`);
    if (!APPLY) continue;

    await preflightUpdatePrivilege(row);
    const result = group.target.seedUrlUpload
      ? await ensureUploadedFromUrl(row, toPath)
      : await ensureCopied(row, toPath);
    if (result.kind === "copied") copied += 1;
    if (result.kind === "uploaded-from-url") uploaded += 1;
    if (result.kind === "already-present") alreadyPresent += 1;
    const publicUrl = await updatePhotoRow(row, toPath);
    updated += 1;
    console.log(`    ${result.kind}, ${result.size} bytes, url=${publicUrl}`);
  }
}

if (APPLY) {
  const after = await loadAuditRows();
  const remaining = after.filter((row) => row.mismatched);
  console.log(
    `\nAPPLIED copied=${copied} uploaded_from_url=${uploaded} already_present=${alreadyPresent} updated_rows=${updated}`,
  );
  console.log(`Remaining prefix mismatches: ${remaining.length}`);
  if (remaining.length > 0) {
    printUnexpected(remaining);
    process.exit(1);
  }

  for (const group of orderedGroups.filter((g) => g.target.key.startsWith("glenrose"))) {
    const count = await verifyPublicListing(group);
    console.log(`Public listing RPC/photo fetch ok: ${group.target.label} (${count} photos)`);
  }
} else {
  console.log(
    "\nDRY-RUN only. Re-run with --apply to copy/upload verified objects and update rows.",
  );
}
