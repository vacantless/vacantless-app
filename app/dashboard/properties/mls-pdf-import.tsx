"use client";

// MLS data-sheet PDF-drop import (S292) — the realtor-onboarding wedge's richer
// acquisition path. A realtor exports their OWN authorized listing as a PDF
// (Client Full / data sheet, downloaded or emailed to themselves) and drops it
// here; we read the text CLIENT-SIDE with pdf.js, assemble it into the same
// paste text the box already accepts (lib/pdf-text), and drop it into the
// mls_text field. The operator reviews it and submits the EXISTING server action
// (importPropertyFromMls -> parseMlsListing), which makes a Draft.
//
// COMPLIANCE: this only interprets a file the operator already holds and chose
// to drop in. No network call, no scrape, no MLS portal access — see
// MLS-IMPORT-COMPLIANCE-DECISION-2026-06-21.md. Pasting text by hand still works
// (the textarea is fully editable); the PDF drop is purely a convenience on top.
//
// TRUST BOUNDARY: this island is UX only. The server action re-parses whatever
// text is submitted and always lands a private Draft for review — the same path
// the paste box has always used. Nothing here is authoritative.

import { useRef, useState } from "react";
import { assembleDocumentText, type PdfTextItemLike } from "@/lib/pdf-text";
import { SubmitButton } from "@/components/submit-button";
import { SECONDARY_ACTION_CLASS } from "@/components/ui";

// A real single-listing data sheet is 1-3 pages and well under a megabyte or
// two; these caps stop a mis-dropped giant PDF from hanging the tab.
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_PAGES = 30;

type Status =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "done"; fileName: string; pages: number }
  | { kind: "error"; message: string };

// Set the pdf.js worker source exactly once. We serve the worker as a vendored
// SAME-ORIGIN static file (public/pdf.worker.min.mjs, copied from the pinned
// pdfjs-dist build) rather than letting webpack emit it — Next's Terser pass
// chokes trying to minify the ESM worker as a classic script. Same-origin means
// no CDN and no runtime external fetch (nothing leaves the device but the worker
// load from our own server). The file is kept in lockstep with the pinned
// pdfjs-dist version; bump both together. Guarded so repeated drops don't
// reassign it. Returns the loaded pdf.js module.
const PDF_WORKER_SRC = "/pdf.worker.min.mjs";
let workerConfigured = false;
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    workerConfigured = true;
  }
  return pdfjs;
}

export function MlsPdfImport({ placeholder }: { placeholder: string }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    // Accept by extension OR mime — some browsers report an empty type for a
    // drag-dropped file.
    const looksPdf =
      file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!looksPdf) {
      setStatus({ kind: "error", message: "That doesn't look like a PDF. Choose a PDF data sheet, or paste the text below." });
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setStatus({ kind: "error", message: "That PDF is too large to read here. Paste the listing text below instead." });
      return;
    }

    setStatus({ kind: "reading", fileName: file.name });
    try {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      const pageCount = Math.min(doc.numPages, MAX_PAGES);
      const pages: PdfTextItemLike[][] = [];
      for (let p = 1; p <= pageCount; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // pdf.js mixes TextItem and TextMarkedContent; only the former carry str.
        pages.push(
          (content.items as Array<Partial<PdfTextItemLike>>).filter(
            (it): it is PdfTextItemLike => typeof it.str === "string",
          ),
        );
      }
      const assembled = assembleDocumentText(pages);
      if (!assembled.trim()) {
        setStatus({
          kind: "error",
          message:
            "Couldn't read any text from that PDF (it may be a scanned image). Paste the listing text below instead.",
        });
        return;
      }
      setText(assembled);
      setStatus({ kind: "done", fileName: file.name, pages: pageCount });
    } catch {
      setStatus({
        kind: "error",
        message:
          "Couldn't read that PDF. Paste the listing text below instead.",
      });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div>
      {/* Dropzone — drag a PDF or click to browse. Keyboard-accessible. */}
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
        aria-label="Drop an MLS data-sheet PDF, or click to choose one"
        className={`mb-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragging
            ? "border-gray-500 bg-gray-50"
            : "border-gray-300 hover:bg-gray-50"
        }`}
      >
        <p className="text-sm font-medium text-gray-700">
          Drop a data-sheet PDF here, or click to choose
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The realtor data sheet (Client Full) you downloaded or emailed
          yourself — we read it on your device, nothing is uploaded.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            // Clear so re-choosing the same file fires onChange again.
            e.target.value = "";
          }}
        />
      </div>

      {/* Status line for the read. */}
      {status.kind === "reading" && (
        <p className="mb-2 text-xs text-gray-500">
          Reading {status.fileName}…
        </p>
      )}
      {status.kind === "done" && (
        <p className="mb-2 text-xs font-medium text-green-700">
          Read {status.fileName} ({status.pages}{" "}
          {status.pages === 1 ? "page" : "pages"}). Review the details below,
          then prefill.
        </p>
      )}
      {status.kind === "error" && (
        <p className="mb-2 text-xs font-medium text-amber-700">{status.message}</p>
      )}

      <p className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-gray-400">
        or paste the listing text
      </p>

      <textarea
        id="mls_text"
        name="mls_text"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="mt-3 flex justify-end">
        <SubmitButton
          pendingLabel="Prefilling…"
          className={SECONDARY_ACTION_CLASS}
          disabled={text.trim().length === 0}
        >
          Prefill from listing
        </SubmitButton>
      </div>
    </div>
  );
}
