"use client";

// Import a whole gallery from a Dropbox shared folder (REAL-WORLD-INTAKE item Q,
// Phase 2) — with the multi-unit follow-on. Operators file every photo/tour-
// vendor delivery into Dropbox, so a shared folder link is the one source that
// works across all listings. Two shapes show up:
//
//   • a single unit's gallery/  -> a flat folder of 0NN-….jpg images
//   • a whole building          -> one subfolder per unit (+ "Outside & Common
//                                  Areas"); the 833 Pillette shape
//
// So the operator pastes the link and we CHECK it first (read-only inspect): a
// flat folder offers a one-click "Import N photos"; a building folder offers a
// unit picker, and the chosen unit's photos import onto THIS rental. The real
// validation/enumeration lives server-side (inspectDropboxFolder +
// importPropertyPhotosFromDropboxFolder); this island is UX/state only and is
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
  const [unit, setUnit] = useState("");

  const trimmed = url.trim();

  async function check() {
    if (!trimmed || checking) return;
    setChecking(true);
    setResult(null);
    setUnit("");
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
        paste it here. You can point at one unit&apos;s gallery folder, or at a
        whole building folder and pick the unit below.
      </p>
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setResult(null); // a changed link must be re-checked
          setUnit("");
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
          <p className="mb-2 text-xs text-gray-600">
            Found {result.count}{" "}
            {result.count === 1 ? "photo" : "photos"} in this folder.
          </p>
          <SubmitButton className={SECONDARY_BTN} pendingLabel="Importing…">
            Import {result.count} {result.count === 1 ? "photo" : "photos"}
          </SubmitButton>
        </form>
      )}

      {result?.kind === "units" && (
        <form
          action={importPropertyPhotosFromDropboxFolder}
          className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="dropbox_url" value={trimmed} />
          <p className="mb-2 text-xs text-gray-600">
            This looks like a building folder. Choose the unit whose photos
            belong on this rental:
          </p>
          <div className="mb-3 space-y-1.5">
            {result.subfolders.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="subfolder"
                  value={s}
                  checked={unit === s}
                  onChange={() => setUnit(s)}
                  className="h-4 w-4 accent-[var(--brand-color)]"
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
          <SubmitButton
            className={SECONDARY_BTN}
            pendingLabel="Importing…"
            disabled={!unit}
          >
            Import this unit&apos;s photos
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
