import { CopyLinkButton } from "@/components/copy-link-button";
import { StatusChip } from "@/components/ui";
import {
  DOCUMENT_TYPES,
  SHARE_LINK_DEFAULT_DAYS,
  documentSharePath,
  documentTypeLabel,
  formatBytes,
  type DocumentType,
} from "@/lib/documents";
import {
  createPropertyDocumentShareLink,
  deletePropertyDocument,
  revokePropertyDocumentShareLink,
  uploadPropertyDocument,
} from "./documents-actions";

export type PropertyShareLinkView = {
  id: string;
  token: string;
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
};

export type PropertyDocumentView = {
  id: string;
  title: string;
  doc_type: string;
  size_bytes: number;
  created_at: string;
  signedUrl: string | null;
  workOrderTitle: string | null;
  shareLinks: PropertyShareLinkView[];
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

const DOC_FLASH: Record<string, string> = {
  uploaded: "Document uploaded.",
  deleted: "Document deleted.",
  shared: "Share link created.",
  revoked: "Share link revoked.",
  forbidden: "You do not have permission to manage documents.",
  none: "Choose a file to upload.",
  type: "Upload a PDF or scan image.",
  size: "That file is too large.",
  failed: "The document could not be uploaded.",
  shareerr: "The share link could not be created.",
  error: "That document could not be found.",
};

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function PropertyDocumentsSection({
  propertyId,
  documents,
  flash,
}: {
  propertyId: string;
  documents: PropertyDocumentView[];
  flash?: string | null;
}) {
  const message = flash ? DOC_FLASH[flash] : null;
  const isError =
    flash === "forbidden" ||
    flash === "none" ||
    flash === "type" ||
    flash === "size" ||
    flash === "failed" ||
    flash === "shareerr" ||
    flash === "error";

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isError
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {message}
        </div>
      )}

      {documents.length > 0 ? (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
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
                      {formatBytes(d.size_bytes)} - added {fmtDay(d.created_at)}
                      {d.workOrderTitle ? ` - ${d.workOrderTitle}` : ""}
                      {activeLinks.length > 0
                        ? ` - ${activeLinks.length} active share link${
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
                    <form action={deletePropertyDocument}>
                      <input type="hidden" name="property_id" value={propertyId} />
                      <input type="hidden" name="document_id" value={d.id} />
                      <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </form>
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-50 pt-2">
                  <form action={createPropertyDocumentShareLink} className="flex items-center gap-2">
                    <input type="hidden" name="property_id" value={propertyId} />
                    <input type="hidden" name="document_id" value={d.id} />
                    <label htmlFor={`share-days-property-${d.id}`} className="text-xs text-gray-500">
                      Share for
                    </label>
                    <select
                      id={`share-days-property-${d.id}`}
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

                {activeLinks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {activeLinks.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5"
                      >
                        <span className="text-xs text-gray-500">
                          Read-only link - expires{" "}
                          {l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "-"}
                        </span>
                        <span className="flex items-center gap-2">
                          <CopyLinkButton path={documentSharePath(l.token)} label="Copy link" />
                          <a
                            href={documentSharePath(l.token)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Preview
                          </a>
                          <form action={revokePropertyDocumentShareLink}>
                            <input type="hidden" name="property_id" value={propertyId} />
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
          No documents stored for this property yet.
        </p>
      )}

      <form
        action={uploadPropertyDocument}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
      >
        <input type="hidden" name="property_id" value={propertyId} />
        <div className="min-w-[14rem] flex-1">
          <label className={labelCls}>File</label>
          <input
            type="file"
            name="document"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            required
            className={inputCls}
          />
        </div>
        <div className="w-44">
          <label className={labelCls}>Type</label>
          <select name="doc_type" defaultValue={"other" as DocumentType} className={inputCls}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {documentTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <label className={labelCls}>Title</label>
          <input name="title" placeholder="Optional" className={inputCls} />
        </div>
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
