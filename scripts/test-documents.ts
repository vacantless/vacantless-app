// Unit tests for the pure document-vault domain model.
// Run: npx tsx scripts/test-documents.ts
import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
  DOCUMENT_TYPES,
  isDocumentType,
  documentTypeLabel,
  isAllowedDocumentType,
  isWithinDocumentSize,
  formatBytes,
  validateDocumentUpload,
  documentUploadErrorMessage,
  extForType,
  documentStoragePath,
  defaultTitleFromFilename,
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  generateShareToken,
  clampShareDays,
  shareLinkExpiry,
  isShareLinkValid,
  shareLinkStatus,
  documentSharePath,
  executedLeaseVaultEntries,
  isExecutedLeasePdf,
  partitionVaultDocuments,
} from "../lib/documents";

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
ok("allowed types = pdf + 3 images", ALLOWED_DOCUMENT_TYPES.length === 4);
ok("isAllowedDocumentType pdf", isAllowedDocumentType("application/pdf"));
ok("isAllowedDocumentType jpeg", isAllowedDocumentType("image/jpeg"));
ok("isAllowedDocumentType rejects docx", !isAllowedDocumentType(
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
));
ok("isAllowedDocumentType rejects gif", !isAllowedDocumentType("image/gif"));
ok("isAllowedDocumentType rejects non-string", !isAllowedDocumentType(123));

// --- Doc type taxonomy ------------------------------------------------------
ok("8 doc types", DOCUMENT_TYPES.length === 8);
ok("isDocumentType lease", isDocumentType("lease"));
ok("isDocumentType receipt", isDocumentType("receipt"));
ok("isDocumentType rejects bogus", !isDocumentType("contract"));
ok("label lease", documentTypeLabel("lease") === "Lease");
ok("label receipt", documentTypeLabel("receipt") === "Receipt");
ok("label id_package", documentTypeLabel("id_package") === "ID / application package");
ok("label unknown -> Other", documentTypeLabel("zzz") === "Other");

// --- Size -------------------------------------------------------------------
ok("max is 25 MB", MAX_DOCUMENT_BYTES === 25 * 1024 * 1024);
ok("within size 1MB", isWithinDocumentSize(1024 * 1024));
ok("within size exactly cap", isWithinDocumentSize(MAX_DOCUMENT_BYTES));
ok("over cap rejected", !isWithinDocumentSize(MAX_DOCUMENT_BYTES + 1));
ok("zero rejected", !isWithinDocumentSize(0));
ok("negative rejected", !isWithinDocumentSize(-5));
ok("non-number rejected", !isWithinDocumentSize("100" as unknown));
ok("upload cap is 10", MAX_DOCUMENTS_PER_UPLOAD === 10);

// --- formatBytes ------------------------------------------------------------
ok("formatBytes MB whole", formatBytes(25 * 1024 * 1024) === "25 MB");
ok("formatBytes MB frac", formatBytes(2.5 * 1024 * 1024) === "2.5 MB");
ok("formatBytes KB", formatBytes(2048) === "2 KB");
ok("formatBytes B", formatBytes(512) === "512 B");

// --- validateDocumentUpload -------------------------------------------------
ok("validate ok pdf", validateDocumentUpload({ type: "application/pdf", size: 1000 }).ok);
{
  const v = validateDocumentUpload({ type: "image/gif", size: 1000 });
  ok("validate bad type", !v.ok && v.reason === "type");
}
{
  const v = validateDocumentUpload({ type: "application/pdf", size: MAX_DOCUMENT_BYTES + 1 });
  ok("validate too big", !v.ok && v.reason === "size");
}
{
  const v = validateDocumentUpload({ type: "application/pdf", size: 0 });
  ok("validate empty", !v.ok && v.reason === "empty");
}
ok("err copy type", documentUploadErrorMessage("type").includes("PDF"));
ok("err copy size mentions 25 MB", documentUploadErrorMessage("size").includes("25 MB"));
ok("err copy empty", documentUploadErrorMessage("empty").length > 0);

// --- ext + path -------------------------------------------------------------
ok("ext pdf", extForType("application/pdf") === "pdf");
ok("ext jpeg", extForType("image/jpeg") === "jpg");
ok("ext png", extForType("image/png") === "png");
ok("ext webp", extForType("image/webp") === "webp");
ok("ext unknown -> bin", extForType("application/zip") === "bin");
ok(
  "storage path = org/doc.ext",
  documentStoragePath("ORG", "DOC", "pdf") === "ORG/DOC.pdf",
);
ok(
  "storage path first segment is org (RLS gate)",
  documentStoragePath("org-1", "doc-9", "pdf").split("/")[0] === "org-1",
);

// --- default title from filename --------------------------------------------
ok("title strips ext", defaultTitleFromFilename("Lease Final.pdf") === "Lease Final");
ok("title strips path", defaultTitleFromFilename("/a/b/Scan.png") === "Scan");
ok("title windows path", defaultTitleFromFilename("C:\\docs\\X.pdf") === "X");
ok("title empty -> Document", defaultTitleFromFilename("") === "Document");
ok("title non-string -> Document", defaultTitleFromFilename(null) === "Document");
ok("title no ext kept", defaultTitleFromFilename("README") === "README");

// --- share token ------------------------------------------------------------
{
  const a = generateShareToken();
  const b = generateShareToken();
  ok("token url-safe", /^[A-Za-z0-9_-]+$/.test(a));
  ok("token length 32", a.length === 32);
  ok("tokens unique", a !== b);
}

// --- clamp days -------------------------------------------------------------
ok("default days 7", SHARE_LINK_DEFAULT_DAYS === 7);
ok("max days 30", SHARE_LINK_MAX_DAYS === 30);
ok("clamp 14 -> 14", clampShareDays(14) === 14);
ok("clamp 0 -> default", clampShareDays(0) === SHARE_LINK_DEFAULT_DAYS);
ok("clamp negative -> default", clampShareDays(-3) === SHARE_LINK_DEFAULT_DAYS);
ok("clamp 999 -> max", clampShareDays(999) === SHARE_LINK_MAX_DAYS);
ok("clamp string '10' -> 10", clampShareDays("10") === 10);
ok("clamp junk -> default", clampShareDays("abc") === SHARE_LINK_DEFAULT_DAYS);
ok("clamp floors floats", clampShareDays(5.9) === 5);

// --- expiry + validity ------------------------------------------------------
{
  const now = new Date("2026-06-26T12:00:00Z");
  const exp = shareLinkExpiry(now, 7);
  ok(
    "expiry is now + 7 days",
    Date.parse(exp) === now.getTime() + 7 * 24 * 60 * 60 * 1000,
  );
  const validLink = { expires_at: exp, revoked_at: null };
  ok("fresh link valid", isShareLinkValid(validLink, now));
  ok(
    "link expired after window",
    !isShareLinkValid(validLink, new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)),
  );
  ok(
    "revoked link invalid",
    !isShareLinkValid({ expires_at: exp, revoked_at: now.toISOString() }, now),
  );
  ok("null expiry invalid", !isShareLinkValid({ expires_at: null, revoked_at: null }, now));
  ok("junk expiry invalid", !isShareLinkValid({ expires_at: "nope", revoked_at: null }, now));

  // status word
  ok("status active", shareLinkStatus(validLink, now) === "active");
  ok(
    "status expired",
    shareLinkStatus(validLink, new Date(now.getTime() + 8 * 86400000)) === "expired",
  );
  ok(
    "status revoked",
    shareLinkStatus({ expires_at: exp, revoked_at: now.toISOString() }, now) === "revoked",
  );
}

// --- share path -------------------------------------------------------------
ok("share path", documentSharePath("abc") === "/d/abc");
ok("share path encodes", documentSharePath("a/b").includes("%2F"));

// --- Slice 4: executed-lease vault entries ----------------------------------
{
  const leases = [
    { id: "a", title: "Lease A", status: "draft", created_at: "2026-01-01T00:00:00Z" },
    { id: "b", title: "Lease B", status: "sent", created_at: "2026-02-01T00:00:00Z" },
    { id: "c", title: "Lease C", status: "executed", created_at: "2026-03-01T00:00:00Z", executed_at: "2026-03-05T00:00:00Z" },
    { id: "d", title: "Lease D", status: "executed", created_at: "2026-04-01T00:00:00Z", executed_at: "2026-04-10T00:00:00Z" },
    { id: "e", title: "Lease E", status: "void", created_at: "2026-05-01T00:00:00Z" },
  ];
  const entries = executedLeaseVaultEntries(leases);
  ok("only executed leases surface", entries.length === 2);
  ok("excludes draft/sent/void", entries.every((e) => e.id === "c" || e.id === "d"));
  ok("newest executed first", entries[0].id === "d" && entries[1].id === "c");
  ok("carries title", entries[0].title === "Lease D");
  ok("carries executed_at", entries[0].executed_at === "2026-04-10T00:00:00Z");

  // executed_at missing -> falls back to created_at for ordering, null in output
  const fallback = executedLeaseVaultEntries([
    { id: "old", title: "Old", status: "executed", created_at: "2026-01-01T00:00:00Z" },
    { id: "new", title: "New", status: "executed", created_at: "2026-06-01T00:00:00Z" },
  ]);
  ok("null executed_at -> null in entry", fallback[0].executed_at === null);
  ok("orders by created_at when executed_at absent", fallback[0].id === "new" && fallback[1].id === "old");

  // mixed: a recent executed_at outranks an older one even with a newer created_at on the loser
  const mixed = executedLeaseVaultEntries([
    { id: "x", title: "X", status: "executed", created_at: "2026-09-01T00:00:00Z", executed_at: "2026-03-01T00:00:00Z" },
    { id: "y", title: "Y", status: "executed", created_at: "2026-01-01T00:00:00Z", executed_at: "2026-08-01T00:00:00Z" },
  ]);
  ok("orders by executed_at not created_at", mixed[0].id === "y");

  ok("empty input -> empty", executedLeaseVaultEntries([]).length === 0);
  ok("no executed -> empty", executedLeaseVaultEntries([
    { id: "z", title: "Z", status: "draft", created_at: "2026-01-01T00:00:00Z" },
  ]).length === 0);
}

// --- Slice 4b (Option C): stored executed-lease PDF partition ---------------
{
  ok("isExecutedLeasePdf true for in_app_executed", isExecutedLeasePdf("in_app_executed"));
  ok("isExecutedLeasePdf false for uploaded", !isExecutedLeasePdf("uploaded"));
  ok("isExecutedLeasePdf false for null", !isExecutedLeasePdf(null));

  // newest-first input; two uploaded files + one stored PDF for executed lease "c".
  const docs = [
    { id: "u1", source: "uploaded", lease_document_id: null },
    { id: "p_c", source: "in_app_executed", lease_document_id: "c" },
    { id: "u2", source: "uploaded", lease_document_id: null },
  ];
  const { uploaded, executedPdfByLeaseId } = partitionVaultDocuments(docs, ["c", "d"]);
  ok("uploaded excludes the folded PDF", uploaded.length === 2 && uploaded.every((d) => d.id !== "p_c"));
  ok("PDF folded under its lease id", executedPdfByLeaseId.get("c")?.id === "p_c");
  ok("no PDF for a lease without one", !executedPdfByLeaseId.has("d"));

  // newest wins when a lease has more than one stored PDF (first seen = newest).
  const dup = partitionVaultDocuments(
    [
      { id: "new", source: "in_app_executed", lease_document_id: "c" },
      { id: "old", source: "in_app_executed", lease_document_id: "c" },
    ],
    ["c"],
  );
  ok("newest stored PDF wins per lease", dup.executedPdfByLeaseId.get("c")?.id === "new");
  ok("older duplicate is dropped, not uploaded", dup.uploaded.length === 0);

  // an in_app_executed row whose lease is NOT executed/known falls back to uploaded
  // (lease_document_id SET NULL after lease removal, or lease no longer executed).
  const orphan = partitionVaultDocuments(
    [
      { id: "orphan_null", source: "in_app_executed", lease_document_id: null },
      { id: "orphan_unknown", source: "in_app_executed", lease_document_id: "gone" },
    ],
    ["c"],
  );
  ok("orphan PDF (null lease) stays visible in uploaded", orphan.uploaded.some((d) => d.id === "orphan_null"));
  ok("orphan PDF (unknown lease) stays visible in uploaded", orphan.uploaded.some((d) => d.id === "orphan_unknown"));
  ok("orphan PDFs not folded", orphan.executedPdfByLeaseId.size === 0);

  ok("empty docs -> empty split", partitionVaultDocuments([], ["c"]).uploaded.length === 0);
}

// ---------------------------------------------------------------------------
console.log(`\ndocuments: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
