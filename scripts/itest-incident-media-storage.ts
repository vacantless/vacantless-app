// INTEGRATION test (NOT a unit test) for the private incident-media bucket.
// Exercises the REAL Slice-1 helpers against the LIVE Supabase project, so it
// needs creds + network and CANNOT run in CI. Run it locally:
//
//   set -a; source .env.local; set +a; npx tsx scripts/itest-incident-media-storage.ts
//
// (or otherwise have NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env)
//
// What it proves end to end:
//   1. createIncidentMediaUploadUrl mints a signed upload URL for an org-scoped path
//   2. the bytes actually upload (uploadToSignedUrl)
//   3. createIncidentMediaDownloadUrl mints a signed URL that returns those bytes
//   4. the object is genuinely PRIVATE — the public URL does NOT serve it
//   5. removeIncidentMedia cleans the object back up
//
// Uses the service-role client (the same client the Slice-2 token RPC will use
// after it validates a tenancy token). A random UUID stands in for org/report id.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  INCIDENT_MEDIA_BUCKET,
  createIncidentMediaUploadUrl,
  createIncidentMediaDownloadUrl,
  removeIncidentMedia,
} from "../lib/incident-media-server";
import { incidentMediaStoragePath, extForType } from "../lib/incident-media";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, extra ?? "");
  }
}

// A 1x1 transparent PNG (smallest valid image).
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.",
    );
    process.exit(2);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgId = randomUUID();
  const reportId = randomUUID();
  const mediaId = randomUUID();
  const path = incidentMediaStoragePath(
    orgId,
    reportId,
    mediaId,
    extForType("image/png"),
  );
  const bytes = Buffer.from(PNG_BASE64, "base64");
  console.log(`\nTesting bucket "${INCIDENT_MEDIA_BUCKET}" with path: ${path}\n`);

  // 1. signed upload URL
  const up = await createIncidentMediaUploadUrl(admin, path);
  ok("1. mint signed upload URL", up.ok === true, up.ok ? "" : up.error);
  if (!up.ok) return finish();

  // 2. upload the bytes via the signed URL
  const put = await admin.storage
    .from(INCIDENT_MEDIA_BUCKET)
    .uploadToSignedUrl(up.path, up.token, bytes, { contentType: "image/png" });
  ok("2. upload bytes to signed URL", !put.error, put.error?.message);

  // 3. signed download URL returns those exact bytes
  const dl = await createIncidentMediaDownloadUrl(admin, path, 60);
  ok("3. mint signed download URL", dl.ok === true, dl.ok ? "" : dl.error);
  if (dl.ok) {
    const res = await fetch(dl.signedUrl);
    const back = Buffer.from(await res.arrayBuffer());
    ok("3b. signed URL fetch is 200", res.status === 200, res.status);
    ok("3c. round-tripped bytes match", back.equals(bytes), `${back.length}b vs ${bytes.length}b`);
  }

  // 4. PRIVACY: the public URL must NOT serve the object (bucket is private)
  const pub = admin.storage.from(INCIDENT_MEDIA_BUCKET).getPublicUrl(path);
  const pubRes = await fetch(pub.data.publicUrl);
  ok(
    "4. public URL is BLOCKED (object is private)",
    pubRes.status === 400 || pubRes.status === 403 || pubRes.status === 404,
    `got HTTP ${pubRes.status}`,
  );

  // 5. cleanup
  const rm = await removeIncidentMedia(admin, [path]);
  ok("5. remove test object", rm.ok === true, rm.ok ? "" : rm.error);

  finish();
}

function finish() {
  console.log(`\nincident-media storage itest: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("itest threw:", e);
  process.exit(1);
});
