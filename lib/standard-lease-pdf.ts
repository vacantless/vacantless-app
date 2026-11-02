// S743: print a Standard Form of Lease (Ontario 2229E, 2020/12) from the
// placements in lib/standard-lease.ts onto the government's flat copy, then
// append the Section 15 additional terms (the lease vault's clauses) as extra
// pages. The template is never edited: values are drawn on top of its pages.

import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  standardLeasePlacements,
  overflowLines,
  signaturePlacements,
  torontoDay,
  type Placement,
  type SignedSigner,
  type StandardLeaseInput,
} from "@/lib/standard-lease";

const TEMPLATE_REL = "lib/forms/ontario-2229e-2020-12-flat.pdf";
export const STANDARD_LEASE_VERSION = "2229E (2020/12)";

let templateCache: Uint8Array | null = null;
function loadTemplate(): Uint8Array {
  if (templateCache) return templateCache;
  const p = path.join(process.cwd(), TEMPLATE_REL);
  if (!fs.existsSync(p)) throw new Error(`Standard lease template missing at ${TEMPLATE_REL} (Vercel file-trace?)`);
  templateCache = new Uint8Array(fs.readFileSync(p));
  return templateCache;
}

/** Helvetica only speaks WinAnsi: swap the usual typographic marks, drop the rest. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, "  ")
    .replace(/[^\x0A\x20-\x7E\u00A1-\u00FF]/g, "");
}

/** Greedy word wrap to a width. Long words are split. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    for (let w of words) {
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

const INK = rgb(0.05, 0.1, 0.45);

function drawPlacement(page: PDFPage, p: Placement, font: PDFFont, bold: PDFFont): void {
  if (p.kind === "check") {
    const size = Math.min(p.w, p.h);
    const tw = bold.widthOfTextAtSize("X", size);
    page.drawText("X", { x: p.x + (p.w - tw) / 2, y: p.y + (p.h - size * 0.72) / 2, size, font: bold, color: INK });
    return;
  }
  const pad = 2;
  const width = p.w - pad * 2;
  if (p.multiLine && p.h > 20) {
    let size = 9;
    let lines = wrap(p.text, font, size, width);
    while (size > 6 && lines.length * size * 1.2 > p.h - pad) { size -= 0.5; lines = wrap(p.text, font, size, width); }
    let y = p.y + p.h - pad - size;
    for (const ln of lines) {
      if (y < p.y) break;
      page.drawText(ln, { x: p.x + pad, y, size, font, color: INK });
      y -= size * 1.2;
    }
    return;
  }
  const text = pdfSafe(p.text).replace(/\n+/g, " ");
  let size = Math.min(10, Math.max(6, p.h - 3));
  while (size > 5.5 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  page.drawText(text, { x: p.x + pad, y: p.y + Math.max(1.5, (p.h - size * 0.72) / 2), size, font, color: INK });
}

export type StandardLeasePdfInput = StandardLeaseInput & {
  /** Section 15 attachment text (lease_documents.assembled_body). */
  additionalTerms: string | null;
  /** S744c: e-signatures to stamp on page 7 (lease_signers rows). */
  signatures?: SignedSigner[];
};

/** Fit an image into a box, keeping its shape, left-aligned and centred up and down. */
export function fitImage(imgW: number, imgH: number, box: [number, number, number, number], pad = 1.5) {
  const bw = box[2] - box[0] - pad * 2;
  const bh = box[3] - box[1] - pad * 2;
  const k = Math.min(bw / imgW, bh / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { x: box[0] + pad, y: box[1] + pad + (bh - h) / 2, width: w, height: h };
}

/** The filled 2229E plus the additional-terms pages. */
export async function fillStandardLease(input: StandardLeasePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(loadTemplate());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  for (const p of standardLeasePlacements(input)) {
    const page = pages[p.page - 1];
    if (page) drawPlacement(page, p, font, bold);
  }

  // S744c: Section 17 e-signatures.
  const sig = signaturePlacements(input.tenantNames, input.signatures ?? []);
  const page7 = pages[6];
  if (page7 && sig.placed.length) {
    const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
    for (const p of sig.placed) {
      if (p.kind === "drawn") {
        try {
          const png = await pdf.embedPng(Buffer.from(p.data.split(",")[1], "base64"));
          page7.drawImage(png, fitImage(png.width, png.height, p.box));
        } catch {
          // A broken image never stops the lease: leave the box for wet ink.
          continue;
        }
      } else {
        drawPlacement(page7, { page: 7, kind: "text", x: p.box[0], y: p.box[1], w: p.box[2] - p.box[0], h: p.box[3] - p.box[1], text: p.data }, oblique, bold);
      }
      if (p.dateText) {
        drawPlacement(page7, { page: 7, kind: "text", x: p.dateBox[0], y: p.dateBox[1], w: p.dateBox[2] - p.dateBox[0], h: p.dateBox[3] - p.dateBox[1], text: p.dateText }, font, bold);
      }
    }
  }
  const sigOverflow = sig.overflow.map(
    (s) => `${s.signedName || s.name || "Tenant"} signed electronically on ${torontoDay(s.signedAt)}.`,
  );

  const extra = [...overflowLines(input), ...(sigOverflow.length ? ["", "Signatures that did not fit on page 7:", ...sigOverflow] : [])];
  const terms = (input.additionalTerms ?? "").trim();
  if (terms || extra.length) {
    const W = 612, H = 792, M = 54, size = 10, lead = 13.5;
    const header = [
      "Attachment to the Residential Tenancy Agreement (Standard Form of Lease, 2229E)",
      `Landlord: ${input.details.landlordLegalName?.trim() || input.landlordName}`,
      `Tenant(s): ${input.tenantNames.join("; ") || "-"}`,
      `Rental unit: ${input.propertyAddress ?? "-"}`,
    ];
    const body = [
      ...(extra.length ? ["Details that did not fit on the form", ...extra, ""] : []),
      ...(terms ? ["Section 15. Additional Terms", "", terms] : []),
    ].join("\n");
    const lines = wrap(body, font, size, W - M * 2);
    const first = pdf.getPageCount() + 1;
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const startPage = (cont: boolean) => {
      header.forEach((h, i) => {
        page.drawText(pdfSafe(cont && i === 0 ? `${h} (continued)` : h), { x: M, y, size: i === 0 ? 11 : 9, font: i === 0 ? bold : font });
        y -= i === 0 ? 16 : 12;
      });
      y -= 10;
    };
    startPage(false);
    for (const ln of lines) {
      if (y < M + 30) { page = pdf.addPage([W, H]); y = H - M; startPage(true); }
      const isHead = ln === "Section 15. Additional Terms" || ln === "Details that did not fit on the form";
      page.drawText(ln, { x: M, y, size: isHead ? 11 : size, font: isHead ? bold : font });
      y -= lead;
    }
    const total = pdf.getPageCount() - first + 1;
    pdf.getPages().slice(first - 1).forEach((pg, i) => {
      pg.drawText(`Attachment page ${i + 1} of ${total}. Tenant initials: ______  Landlord initials: ______`, { x: M, y: 30, size: 8, font });
    });
  }
  pdf.setTitle("Residential Tenancy Agreement (Standard Form of Lease)");
  pdf.setProducer("Vacantless");
  return pdf.save();
}
