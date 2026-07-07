"use client";

// AI listing import from IMAGE(S) (Feature B Slice 2, S430) - the sibling of the
// MLS text/PDF paste box (mls-pdf-import.tsx). Some listings only exist as a
// picture: a screenshot of a Facebook/Kijiji post, a photo of a paper flyer, a
// property-manager PDF page saved as an image. There's no text to paste, so the
// operator drops the image(s) here and the server action (importListingFromImages)
// sends them to the model, which reads them into the SAME draft the text path
// produces.
//
// This island is UX only. The chosen files post natively via a real <input
// type="file" name="listing_images" multiple>; drag-drop just fills that input
// via a DataTransfer so nothing here is authoritative. The server re-validates
// type/size/count and always lands a private Draft for review.
//
// GATED / DARK: the parent form is only rendered when LISTING_AI_IMPORT_ENABLED
// is set AND the org is on a plan with the entitlement (Growth+), so operators
// never see this until Noam flips the flag. The action re-checks the gate.

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { SECONDARY_ACTION_CLASS } from "@/components/ui";

// Keep these in lockstep with the server caps in lib/listing-extract-vision.ts
// (MAX_IMAGES / MAX_IMAGE_BYTES). Client-side filtering is a courtesy so the
// operator sees "using the first 4" before submit; the server enforces the truth.
const MAX_FILES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

type Pick = { name: string; url: string };

export function ListingImageImport() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Take a set of dropped/chosen files, keep the usable ones, reflect them into
  // the real file input (so they submit) and into local state (for the preview).
  function ingest(fileList: FileList | File[]) {
    const all = Array.from(fileList);
    const good: File[] = [];
    let rejectedType = false;
    let rejectedSize = false;
    for (const f of all) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) {
        rejectedType = true;
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        rejectedSize = true;
        continue;
      }
      good.push(f);
      if (good.length >= MAX_FILES) break;
    }

    if (good.length === 0) {
      setNote(
        rejectedSize && !rejectedType
          ? "Those images are too large (8 MB max each). Try a smaller screenshot."
          : "Choose JPG, PNG, WebP, or GIF images of the listing.",
      );
      return;
    }

    // Reflect into the real input so the files post with the form. Drag-drop
    // doesn't set input.files on its own; a DataTransfer does (modern browsers).
    const dt = new DataTransfer();
    good.forEach((f) => dt.items.add(f));
    if (inputRef.current) inputRef.current.files = dt.files;

    // Revoke any previous preview URLs before replacing them.
    setPicks((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return good.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    });

    const dropped = all.length - good.length;
    setNote(
      dropped > 0
        ? `Using ${good.length} image${good.length > 1 ? "s" : ""}; skipped ${dropped} that didn't fit (type, size, or the ${MAX_FILES}-image limit).`
        : null,
    );
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) ingest(files);
  }

  return (
    <div>
      {/* Dropzone - drag images or click to browse. Keyboard-accessible. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Drop listing images, or click to choose"
        className={`mb-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? "border-gray-500 bg-gray-50" : "border-gray-300 hover:bg-gray-50"
        }`}
      >
        <p className="text-sm font-medium text-gray-700">
          Drop listing images here, or click to choose
        </p>
        <p className="mt-1 text-xs text-gray-500">
          A screenshot or photo of the listing (up to {MAX_FILES}). We read it on
          our server to prefill a draft. Nothing is published.
        </p>
        <input
          ref={inputRef}
          type="file"
          name="listing_images"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) ingest(e.target.files);
          }}
        />
      </div>

      {/* Selected previews. */}
      {picks.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {picks.map((p) => (
            // A local object-URL (blob:) preview of the just-picked file, never a
            // remote asset, so next/image optimization doesn't apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.url}
              src={p.url}
              alt={p.name}
              className="h-16 w-16 rounded border border-gray-200 object-cover"
            />
          ))}
        </div>
      )}

      {note && <p className="mb-2 text-xs font-medium text-amber-700">{note}</p>}

      <div className="mt-1 flex justify-end">
        <SubmitButton
          pendingLabel="Reading images…"
          className={SECONDARY_ACTION_CLASS}
          disabled={picks.length === 0}
        >
          Prefill from images
        </SubmitButton>
      </div>
    </div>
  );
}
