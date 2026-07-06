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
import { extractLeaseFromText } from "../actions";
import type { LeaseDraft } from "@/lib/lease-extract";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const FIRST_PAGES = 8; // Noam S425: material terms + the additional-terms schedule.

type PropertyOpt = { id: string; address: string };

type Status =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "thinking"; fileName: string }
  | { kind: "done"; fileName: string; draft: LeaseDraft; matchedAddress: string | null }
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

export function LeaseUploadPrefill({ properties }: { properties: PropertyOpt[] }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    let text = "";
    try {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      const pageCount = Math.min(doc.numPages, FIRST_PAGES);
      const pages: PdfTextItemLike[][] = [];
      for (let p = 1; p <= pageCount; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        pages.push(
          (content.items as Array<Partial<PdfTextItemLike>>).filter(
            (it): it is PdfTextItemLike => typeof it.str === "string",
          ),
        );
      }
      text = assembleDocumentText(pages).trim();
    } catch {
      setStatus({ kind: "error", message: "Couldn't read that PDF (it may be a scanned image). Fill the form manually below." });
      return;
    }
    if (!text) {
      setStatus({ kind: "error", message: "Couldn't read any text from that PDF (it may be a scanned image). Fill the form manually below." });
      return;
    }

    setStatus({ kind: "thinking", fileName: file.name });
    try {
      const result = await extractLeaseFromText(text);
      if (!result.ok) {
        if (result.reason === "empty") {
          setStatus({ kind: "empty" });
        } else {
          setStatus({ kind: "error", message: "Couldn't pull the lease details automatically. Fill the form manually below." });
        }
        return;
      }
      const matchedAddress = applyDraft(result.draft);
      setStatus({ kind: "done", fileName: file.name, draft: result.draft, matchedAddress });
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
        <p className="mt-1 text-xs text-gray-500">We read the first {FIRST_PAGES} pages on your device.</p>
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
