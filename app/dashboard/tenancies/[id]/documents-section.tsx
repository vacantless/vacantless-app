import { CopyLinkButton } from "@/components/copy-link-button";
import { StatusChip } from "@/components/ui";
import {
  DOCUMENT_TYPES,
  documentTypeLabel,
  documentSharePath,
  formatBytes,
  SHARE_LINK_DEFAULT_DAYS,
  type DocumentType,
} from "@/lib/documents";
import {
  uploadTenancyDocuments,
  deleteTenancyDocument,
  createDocumentShareLink,
  revokeDocumentShareLink,
} from "./documents-actions";

// The per-tenancy document vault section (Slices 1+2). Server component: it
// renders the upload form + the stored-document list with short-lived signed
// download URLs (minted by the page) and the share-link controls. Mirrors the
// "tenant reporting link" pattern in the Maintenance section.

export type ShareLinkView = {
  id: string;
  token: string;
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
};

export type DocumentView = {
  id: string;
  title: string;
  doc_type: string;
  size_bytes: number;
  created_at: string;
  /** display name of the person this document is filed about, if any (Slice 3). */
  aboutPersonName: string | null;
  signedUrl: string | null;
  shareLinks: ShareLinkView[];
};

/** A tenant the operator can attribute an upload to (Slice 3 person filing). */
export type DocumentTenantOption = { id: string; name: string };

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export function TenancyDocumentsSection({
  tenancyId,
  documents,
  tenants = [],
}: {
  tenancyId: string;
  documents: DocumentView[];
  tenants?: DocumentTenantOption[];
}) {
  return (
    <div className="mb-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-600">
        Store signed leases, amendments, notices, and other documents for this
        tenancy. Files are private — only you can see them, and each download
        uses a short-lived secure link. Share any document with an expiring,
        revocable read-only link.
      </p>

      {/* Stored documents ------------------------------------------------- */}
      {documents.length > 0 ? (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
          {documents.map((d) => {
            const activeLinks = d.shareLinks.filter((l) => l.status === "active");
            return (
              <li key={d.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium text-gray-900">{d.title}</span>
                    <span className="ml-2">
                      <StatusChip tone="neutral">{documentTypeLabel(d.doc_type)}</StatusChip>
                    </span>
                    <span className="ml-2 block text-xs text-gray-400">
                      {formatBytes(d.size_bytes)} · added{" "}
                      {new Date(d.created_at).toLocaleDateString()}
                      {d.aboutPersonName ? ` · about ${d.aboutPersonName}` : ""}
                      {activeLinks.length > 0
                        ? ` · ${activeLinks.length} active share link${
                            activeLinks.length === 1 ? "" : "s"
                          }`
                        : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {d.signedUrl ? (
                      <a
                        href={d.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">Unavailable</span>
                    )}
                    <form action={deleteTenancyDocument}>
                      <input type="hidden" name="tenancy_id" value={tenancyId} />
                      <input type="hidden" name="document_id" value={d.id} />
                      <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </form>
                  </span>
                </div>

                {/* Share controls */}
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-50 pt-2">
                  <form action={createDocumentShareLink} className="flex items-center gap-2">
                    <input type="hidden" name="tenancy_id" value={tenancyId} />
                    <input type="hidden" name="document_id" value={d.id} />
                    <label className="text-xs text-gray-500">Share for</label>
                    <select
                      name="days"
                      defaultValue={String(SHARE_LINK_DEFAULT_DAYS)}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="1">1 day</option>
                      <option value="7">7 days</option>
                      <option value="14">14 days</option>
                      <option value="30">30 days</option>
                    </select>
                    <button className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
                      Create share link
                    </button>
                  </form>
                </div>

                {/* Active share links */}
                {activeLinks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {activeLinks.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5"
                      >
                        <span className="text-xs text-gray-500">
                          Read-only link · expires{" "}
                          {l.expires_at
                            ? new Date(l.expires_at).toLocaleDateString()
                            : "—"}
                        </span>
                        <span className="flex items-center gap-2">
                          <CopyLinkButton
                            path={documentSharePath(l.token)}
                            label="Copy link"
                          />
                          <a
                            href={documentSharePath(l.token)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Preview →
                          </a>
                          <form action={revokeDocumentShareLink}>
                            <input type="hidden" name="tenancy_id" value={tenancyId} />
                            <input type="hidden" name="link_id" value={l.id} />
                            <button className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                              Revoke
                            </button>
                          </form>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No documents stored for this tenancy yet.
        </p>
      )}

      {/* Upload form ------------------------------------------------------ */}
      <form
        action={uploadTenancyDocuments}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
      >
        <input type="hidden" name="tenancy_id" value={tenancyId} />
        <div className="min-w-[14rem] flex-1">
          <label className={labelCls}>File (PDF or scan image)</label>
          <input
            type="file"
            name="documents"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            multiple
            required
            className={inputCls}
          />
        </div>
        <div className="w-44">
          <label className={labelCls}>Type</label>
          <select name="doc_type" defaultValue={"lease" as DocumentType} className={inputCls}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {documentTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <label className={labelCls}>Title (optional — single file)</label>
          <input name="title" placeholder="e.g. Executed lease 2026" className={inputCls} />
        </div>
        {tenants.length > 0 && (
          <div className="w-48">
            <label className={labelCls}>About (optional)</label>
            <select name="about_tenant_id" defaultValue="" className={inputCls}>
              <option value="">— the tenancy</option>
              {tenants.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Upload
        </button>
      </form>
    </div>
  );
}
