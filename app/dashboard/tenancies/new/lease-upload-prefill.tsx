"use client";

// Lease-OCR prefill island (S425) - drop a signed lease PDF and pre-fill the
// New-Tenancy form. We read the FIRST 8 PAGES of text on-device with pdf.js
// (same approach as the MLS PDF-drop import), send that text to the
// extractLeaseFromText server action (which calls the model + runs the PII
// guard), and fill the sibling form fields with the returned draft. Nothing is
// uploaded or stored; the lease bytes never leave the device (only the extracted
// text goes to the model, transiently). Review-first: every field stays editable
// and the operator submits the unchanged createTenancy action.
//
// The clause digest (deposit type, lease type, pets/smoking/utilities/parking/
// due-day/late-fee) has no dedicated field on this form yet (pets/smoking live on
// the PROPERTY record, not the tenancy - see the spec), so Phase 1 shows it in a
// "What the lease says" panel AND drops a plain-language summary into the Other-
// notes box so it persists. Promoting those to real toggles is the next slice.

import { useRef, useState } from "react";
import { assembleDocumentText, type PdfTextItemLike } from "@/lib/pdf-text";
import { extractLease } from "../actions";
import type { LeaseDraft } from "@/lib/lease-extract";
import { locateLeasePages, leaseAnchorLabel, MAX_SCAN_PAGES } from "@/lib/lease-locator";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const FIRST_PAGES = 8; // fallback window when no lease document is located.
/** Cap raster width so the page images stay small (bounds the API image tokens). */
const RASTER_MAX_WIDTH = 1600;
/** JPEG quality for the page rasters - readable text at a fraction of PNG size. */
const RASTER_QUALITY = 0.8;

type PropertyOpt = { id: string; address: string };

type Status =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "thinking"; fileName: string }
  | {
      kind: "done";
      fileName: string;
      draft: LeaseDraft;
      matchedAddress: string | null;
      located: string | null;
    }
  | { kind: "empty" }
  | { kind: "error"; message: string };

// Load pdf.js with the vendored same-origin worker (public/pdf.worker.min.mjs),
// exactly as the MLS import does. Guarded so repeated drops don't reassign it.
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

function setVal(id: string, value: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (el) el.value = value;
}

/** Normalize an address to comparable tokens (lowercase, strip punctuation). */
function addrTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Best-effort match of the lease's unit_address to one of the org's units.
 * Scores shared tokens, requiring the street NUMBER to match so "12 Main" never
 * matches "120 Main". Returns the property id or null (leave the select alone). */
function matchProperty(unitAddress: string | null, options: PropertyOpt[]): PropertyOpt | null {
  if (!unitAddress) return null;
  const leaseTokens = addrTokens(unitAddress);
  const leaseNums = new Set(leaseTokens.filter((t) => /^\d+$/.test(t)));
  let best: { opt: PropertyOpt; score: number } | null = null;
  for (const opt of options) {
    const optTokens = addrTokens(opt.address);
    const optNums = new Set(optTokens.filter((t) => /^\d+$/.test(t)));
    // Require at least one shared street number.
    const sharedNum = [...leaseNums].some((n) => optNums.has(n));
    if (!sharedNum) continue;
    const shared = optTokens.filter((t) => leaseTokens.includes(t)).length;
    if (!best || shared > best.score) best = { opt, score: shared };
  }
  return best ? best.opt : null;
}

function centsToDollars(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toString();
}

function yesNo(v: boolean | null): string | null {
  return v == null ? null : v ? "allowed" : "not allowed";
}

/** Build the plain-language digest lines for the fields with no form field. */
function digestLines(d: LeaseDraft): string[] {
  const lines: string[] = [];
  if (d.deposit_type) lines.push(`Deposit type: ${d.deposit_type === "lmr" ? "last month's rent" : "security"}`);
  if (d.lease_type) lines.push(`Lease type: ${d.lease_type === "fixed" ? "fixed term" : "month-to-month"}`);
  const pets = yesNo(d.pets_allowed);
  if (pets) lines.push(`Pets: ${pets}`);
  const smoking = yesNo(d.smoking_allowed);
  if (smoking) lines.push(`Smoking: ${smoking}`);
  if (d.utilities_tenant_pays) lines.push(`Tenant pays: ${d.utilities_tenant_pays}`);
  if (d.parking) lines.push(`Parking: ${d.parking}`);
  if (d.rent_due_day != null) lines.push(`Rent due day: ${d.rent_due_day}`);
  if (d.late_fee) lines.push(`Late fee: ${d.late_fee}`);
  if (d.notes) lines.push(`Notes: ${d.notes}`);
  return lines;
}

export function LeaseUploadPrefill({
  properties,
  entitled = true,
}: {
  properties: PropertyOpt[];
  entitled?: boolean;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tier gate: an un-entitled plan (Free/legacy) sees the feature LOCKED with an
  // upsell, never hidden (the standing visibility rule). The server action also
  // enforces this, so this is purely the surface.
  if (!entitled) {
    return (
      <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
        <p className="text-sm font-semibold text-gray-700">Pre-fill a tenancy from the signed lease</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Upload the lease and we read the key terms into this form for you. Available on the Growth and
          Premium plans.
        </p>
      </div>
    );
  }

  function applyDraft(d: LeaseDraft): string | null {
    if (d.start_date) setVal("tenancy-start-date", d.start_date);
    if (d.end_date) setVal("tenancy-end-date", d.end_date);
    if (d.term_months != null) setVal("tenancy-term-months", String(d.term_months));
    if (d.rent_cents != null) setVal("tenancy-rent", centsToDollars(d.rent_cents));
    if (d.deposit_cents != null) setVal("tenancy-deposit", centsToDollars(d.deposit_cents));

    // Tenants -> the fixed 3 rows (row 0 is primary by default).
    d.tenants.slice(0, 3).forEach((t, i) => {
      if (t.name) setVal(`tenant-name-${i}`, t.name);
      if (t.email) setVal(`tenant-email-${i}`, t.email);
      if (t.phone) setVal(`tenant-phone-${i}`, t.phone);
    });

    // Property match (best-effort; leave the select alone if unsure).
    const match = matchProperty(d.unit_address, properties);
    if (match) setVal("tenancy-property-id", match.id);

    // Clause digest -> Other-notes, but only if the operator hasn't typed there.
    const notesEl = document.getElementById("tenancy-notes") as HTMLTextAreaElement | null;
    const lines = digestLines(d);
    if (notesEl && !notesEl.value.trim() && lines.length > 0) {
      notesEl.value = "From the lease (please verify): " + lines.join("; ") + ".";
    }
    return match ? match.address : null;
  }

  async function handleFile(file: File) {
    const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!looksPdf) {
      setStatus({ kind: "error", message: "That doesn't look like a PDF. Choose the lease PDF, or fill the form manually below." });
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setStatus({ kind: "error", message: "That PDF is too large to read here. Fill the form manually below." });
      return;
    }

    setStatus({ kind: "reading", fileName: file.name });

    // 1) Read the WHOLE bundle's text (up to the scan cap) so we can LOCATE the
    //    lease document inside it - real packages bury the lease behind a RECO
    //    guide / rep agreement, in a varying order (S425).
    let located: string | null = null;
    const windowPages: number[] = []; // 1-based page numbers to send the model
    let windowText = "";
    const images: Array<{ base64: string; mimeType: string }> = [];
    try {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      const scanCount = Math.min(doc.numPages, MAX_SCAN_PAGES);

      const itemsByPage: PdfTextItemLike[][] = [];
      const pageTexts: string[] = [];
      for (let p = 1; p <= scanCount; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const items = (content.items as Array<Partial<PdfTextItemLike>>).filter(
          (it): it is PdfTextItemLike => typeof it.str === "string",
        );
        itemsByPage.push(items);
        pageTexts.push(assembleDocumentText([items]).trim());
      }

      // 2) Locate the lease; window from the anchor. If nothing is recognised
      //    (e.g. an unusual custom agreement), fall back to the first pages.
      const loc = locateLeasePages(pageTexts);
      if (loc) {
        located = `${leaseAnchorLabel(loc.anchor)}, from page ${loc.startPage + 1}`;
        for (let i = 0; i < loc.pageCount; i++) windowPages.push(loc.startPage + i + 1);
      } else {
        const end = Math.min(doc.numPages, FIRST_PAGES);
        for (let p = 1; p <= end; p++) windowPages.push(p);
      }

      windowText = assembleDocumentText(windowPages.map((p) => itemsByPage[p - 1] ?? [])).trim();

      // 3) Rasterize the located pages to JPEGs (default path) so the model reads
      //    each filled value beside its label - signed OREA forms scramble in
      //    text extraction (S425, 50 Glenrose).
      setStatus({ kind: "thinking", fileName: file.name });
      for (const p of windowPages) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const scale = base.width > 0 ? Math.min(2, RASTER_MAX_WIDTH / base.width) : 1;
        const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", RASTER_QUALITY);
        const comma = dataUrl.indexOf(",");
        if (comma >= 0) images.push({ base64: dataUrl.slice(comma + 1), mimeType: "image/jpeg" });
      }
    } catch {
      setStatus({ kind: "error", message: "Couldn't read that PDF. Fill the form manually below." });
      return;
    }

    if (images.length === 0 && !windowText) {
      setStatus({ kind: "error", message: "Couldn't read any content from that PDF. Fill the form manually below." });
      return;
    }

    // 4) Extract in ONE server call (images preferred, text fallback) so the
    //    monthly cap is claimed exactly once.
    setStatus({ kind: "thinking", fileName: file.name });
    try {
      const result = await extractLease({
        images: images.length > 0 ? images : undefined,
        text: windowText || undefined,
      });
      if (!result.ok) {
        if (result.reason === "empty") {
          setStatus({ kind: "empty" });
        } else if (result.reason === "locked") {
          setStatus({ kind: "error", message: "Lease import is available on the Growth and Premium plans. Fill the form manually below." });
        } else if (result.reason === "limit") {
          setStatus({ kind: "error", message: "You've reached this month's lease-import limit. Fill the form manually below, or try again next month." });
        } else {
          setStatus({ kind: "error", message: "Couldn't pull the lease details automatically. Fill the form manually below." });
        }
        return;
      }
      const matchedAddress = applyDraft(result.draft);
      setStatus({ kind: "done", fileName: file.name, draft: result.draft, matchedAddress, located });
    } catch {
      setStatus({ kind: "error", message: "Something went wrong reading the lease. Fill the form manually below." });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  const busy = status.kind === "reading" || status.kind === "thinking";

  return (
    <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-gray-700">Have the signed lease? Pre-fill from it</p>
      <p className="mb-3 mt-0.5 text-xs text-gray-500">
        Drop the lease PDF and we&apos;ll read the key terms into the form below for you to review.
        We read it on your device; the lease is never stored, and private IDs (SIN, banking, licence) are never captured.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Drop the signed lease PDF, or click to choose one"
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? "border-gray-500 bg-gray-50" : "border-gray-300 hover:bg-gray-50"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="text-sm font-medium text-gray-700">Drop the lease PDF here, or click to choose</p>
        <p className="mt-1 text-xs text-gray-500">We find the lease inside the file (even in a big package) and read its key pages on your device.</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {status.kind === "reading" && (
        <p className="mt-2 text-xs text-gray-500">Reading {status.fileName}…</p>
      )}
      {status.kind === "thinking" && (
        <p className="mt-2 text-xs text-gray-500">Reading the lease terms…</p>
      )}
      {status.kind === "empty" && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          Couldn&apos;t find lease details in that file. Fill the form manually below.
        </p>
      )}
      {status.kind === "error" && (
        <p className="mt-2 text-xs font-medium text-amber-700">{status.message}</p>
      )}

      {status.kind === "done" && (
        <div className="mt-3">
          <p className="text-xs font-medium text-green-700">
            Pre-filled from {status.fileName}. Review every field below before saving.
          </p>
          {status.located && (
            <p className="mt-1 text-xs text-gray-500">Found the {status.located}.</p>
          )}
          {status.matchedAddress ? (
            <p className="mt-1 text-xs text-gray-500">Matched unit: {status.matchedAddress} (confirm it&apos;s right).</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">Couldn&apos;t match the unit automatically - pick the rental below.</p>
          )}
          {digestLines(status.draft).length > 0 && (
            <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-600">What the lease says (please verify)</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-gray-600">
                {digestLines(status.draft).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-gray-400">
                These are copied into Other notes below. Pet/smoking rules are set on the rental itself.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
