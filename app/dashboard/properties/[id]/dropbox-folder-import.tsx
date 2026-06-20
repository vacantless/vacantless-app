"use client";

// Import a whole gallery from a Dropbox shared folder (REAL-WORLD-INTAKE item Q,
// Phase 2) — with deep-nesting support. Operators file every photo/tour-vendor
// delivery into Dropbox, so a shared folder link is the one source that works
// across all listings. But real archives don't fit a clean "one folder per
// unit" model — they nest by YEAR and PURPOSE several levels deep, e.g.
//
//   <listing> > updated 2019 / 2022 - unit 1 / 2023 > … > gallery / mls photos
//   506 Manning Ave > Unit 1 > mls photos unit 1 / photos-print_… / 2019 > …
//
// So the operator pastes the link and we CHECK it (read-only recursive inspect):
// one gallery imports in a click; several galleries become a pick list showing
// each folder's path + photo count, and the chosen folder imports onto THIS
// rental. The real enumeration/validation lives server-side (inspectDropboxFolder
// + importPropertyPhotosFromDropboxFolder); this island is UX/state only and is
// never the trust boundary — the import action re-lists + re-confirms the choice.

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { dropboxImportErrorMessage } from "@/lib/dropbox-import";
import {
  inspectDropboxFolder,
  importPropertyPhotosFromDropboxFolder,
  type DropboxInspectResult,
} from "../actions";

const SECONDARY_BTN =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";

export function DropboxFolderImport({ propertyId }: { propertyId: string }) {
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<DropboxInspectResult | null>(null);
  // null = nothing picked yet; "" is itself a valid choice (top-level folder).
  const [folder, setFolder] = useState<string | null>(null);

  const trimmed = url.trim();

  async function check() {
    if (!trimmed || checking) return;
    setChecking(true);
    setResult(null);
    setFolder(null);
    try {
      setResult(await inspectDropboxFolder(trimmed));
    } catch {
      // A thrown action (e.g. a permission redirect) or network blip — show a
      // generic failure rather than leaving the operator with no feedback.
      setResult({ kind: "error", reason: "dropboxfailed" });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mt-2">
      <p className="mb-2 text-xs text-gray-500">
        In Dropbox, open the folder, choose <strong>Share</strong> →{" "}
        <strong>Copy link</strong> (set so anyone with the link can view), and
        paste it here. You can point at a gallery folder, or at a higher-level
        listing folder and pick the photo set below.
      </p>
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setResult(null); // a changed link must be re-checked
          setFolder(null);
        }}
        placeholder="https://www.dropbox.com/scl/fo/…?rlkey=…"
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={check}
          disabled={!trimmed || checking}
          className={SECONDARY_BTN}
        >
          {checking ? "Checking…" : "Check folder"}
        </button>
      </div>

      {result?.kind === "flat" && (
        <form
          action={importPropertyPhotosFromDropboxFolder}
          className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="dropbox_url" value={trimmed} />
          <input type="hidden" name="folder" value={result.folder} />
          <p className="mb-2 text-xs text-gray-600">
            Found {result.count}{" "}
            {result.count === 1 ? "photo" : "photos"} in this folder.
          </p>
          <SubmitButton className={SECONDARY_BTN} pendingLabel="Importing…">
            Import {result.count} {result.count === 1 ? "photo" : "photos"}
          </SubmitButton>
        </form>
      )}

      {result?.kind === "folders" && (
        <form
          action={importPropertyPhotosFromDropboxFolder}
          className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="dropbox_url" value={trimmed} />
          <p className="mb-2 text-xs text-gray-600">
            This link has photos in several folders. Pick the set for this
            rental:
          </p>
          <div className="mb-3 max-h-64 space-y-1.5 overflow-auto">
            {result.folders.map((f) => (
              <label
                key={f.path}
                className="flex items-start gap-2 text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="folder"
                  value={f.path}
                  checked={folder === f.path}
                  onChange={() => setFolder(f.path)}
                  className="mt-0.5 h-4 w-4 accent-[var(--brand-color)]"
                />
                <span>
                  {f.label}{" "}
                  <span className="text-gray-400">
                    — {f.count} {f.count === 1 ? "photo" : "photos"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <SubmitButton
            className={SECONDARY_BTN}
            pendingLabel="Importing…"
            disabled={folder === null}
          >
            Import these photos
          </SubmitButton>
        </form>
      )}

      {result?.kind === "error" && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {dropboxImportErrorMessage(result.reason)}
        </p>
      )}
    </div>
  );
}
