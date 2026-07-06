// ============================================================================
// Lease locator (S425 Slice 1a) - find WHICH pages of an uploaded PDF are the
// actual lease. Real lease packages are BUNDLES: a RECO Information Guide, a
// tenant representation agreement, a confirmation-of-cooperation form, the
// Agreement to Lease, the Ontario Standard Lease, schedules - in a VARYING order
// (Noam, S425, proven on the 50 Glenrose bundle where the Agreement to Lease
// started on page 19 of 28, behind the guide + a Form 372 rep agreement). So we
// must NOT take "the first 8 pages of the PDF"; we anchor on the lease document
// itself by its OREA/RTA form number and title, then window from there.
//
// PURE: input is the per-page extracted text; output is the page window. No I/O,
// unit-tested via scripts/test-lease-locator.ts (incl. a fixture from the real
// 50 Glenrose bundle). The client (lease-upload-prefill) does the PDF reading and
// then rasterizes ONLY the located pages for the model.
//
// PRIORITY: prefer the Ontario Standard Lease (the RTA-mandated "Residential
// Tenancy Agreement (Standard Form of Lease)", gov form 2229) when present, since
// it is the binding tenancy document; else the Agreement to Lease (OREA Form 400,
// the accepted offer). Rep agreements (Form 372/371), listing agreements, RECO
// guides, and co-op confirmations (Form 320/324) are never the lease.
// ============================================================================

/** How many pages to hand the model once the lease is located. An OREA Form 400
 * is 5 pages + schedules; the RTA standard lease is ~13; 8 from the anchor covers
 * the material terms + the additional-terms schedule without dragging in the next
 * document (Noam's "first 8 pages of the AGREEMENT"). */
export const LEASE_WINDOW_PAGES = 8;

/** Cap the whole-PDF scan so a pathological upload can't blow up (a real bundle
 * is well under this). */
export const MAX_SCAN_PAGES = 40;

export type LeaseAnchor = "standard_lease" | "agreement_to_lease" | "custom_lease";

export type LeaseLocation = {
  /** 0-based index of the first lease page. */
  startPage: number;
  /** Number of pages to take (<= LEASE_WINDOW_PAGES, clamped to the doc end). */
  pageCount: number;
  /** Which document we anchored on (for UX + logging). */
  anchor: LeaseAnchor;
};

type PageClass = LeaseAnchor | "other";

/** Classify a single page by the OREA/RTA FORM NUMBER printed on it (the reliable
 * signal - it appears on every page of a form, e.g. "Form 400  Revised 2026  Page
 * 1 of 5") plus title fallbacks. Form 372 pages mention "agreement to lease" in
 * their body, so we must key on the form NUMBER/title, not incidental mentions. */
export function classifyLeasePage(text: string): PageClass {
  const t = text.toLowerCase();
  const formMatch = t.match(/form\s*(\d{3,4})/);
  const formNum = formMatch ? formMatch[1] : null;

  // The FORM NUMBER is authoritative and wins first: an OREA Form 400 page is the
  // Agreement to Lease even though its body REFERENCES the "Residential Tenancy
  // Agreement (Standard Form of Lease)" (that incidental mention wrongly matched
  // the standard-lease text check, flagging Form 400 pages as the standard lease -
  // KI, 50 Glenrose). Only the gov standard lease itself is form 2229.
  if (formNum === "400") return "agreement_to_lease";
  if (formNum === "2229") return "standard_lease";

  // Standard Lease with no OREA form number - the common SELF-SERVE case (Noam,
  // S425: a landlord without a realtor uses ONLY the Ontario government
  // Residential Tenancy Agreement / Standard Form of Lease, form 2229E, and there
  // is no Form 400 at all). Key on its distinctive title OR its RTA hallmarks so
  // we recognise the gov lease even when the exact "(Standard Form of Lease)"
  // parenthetical isn't in the extracted text.
  if (
    /residential tenancy agreement\s*\(standard/.test(t) ||
    /\(standard form of lease\)/.test(t) ||
    (/residential tenancy agreement/.test(t) &&
      /(landlord and tenant board|residential tenancies act|this tenancy agreement is required|ontario\.ca\/rta)/.test(
        t,
      ))
  ) {
    return "standard_lease";
  }

  // A title-only Agreement to Lease with no form number, but guard against the
  // rep/listing/co-op forms whose bodies also say "agreement to lease".
  const isRepOrCoop =
    (formNum != null && /^3\d\d$/.test(formNum)) || // 3xx = rep/listing/co-op family
    /representation agreement|confirmation of co-?operation|reco information guide|information guide/.test(t);
  if (!isRepOrCoop && /\bagreement to lease\b/.test(t) && /\b(tenant|landlord|premises|rent)\b/.test(t)) {
    // Only treat as a lease page if it reads like the form itself (has the term
    // words), not a one-line mention.
    const mentions = (t.match(/\bagreement to lease\b/g) || []).length;
    if (mentions >= 1 && /\bpremises\b/.test(t)) return "agreement_to_lease";
  }

  // CUSTOM lease (Noam, S425): some landlords use neither an OREA form nor the gov
  // standard lease - they write their OWN agreement. It matches no form number or
  // title, so fall back to a content heuristic: a page that reads like the START
  // of a lease (names both parties, states rent, and uses lease/tenancy/term
  // wording) and is NOT a rep/co-op/guide page. Lowest priority - a recognised
  // form always wins over this (see locateLeasePages).
  if (
    !isRepOrCoop &&
    /\blandlord\b/.test(t) &&
    /\btenant\b/.test(t) &&
    /\brent\b/.test(t) &&
    /\b(lease|tenancy|term of the|monthly)\b/.test(t)
  ) {
    return "custom_lease";
  }

  return "other";
}

/**
 * Locate the lease within a bundle from the per-page text. Prefers the Standard
 * Lease; falls back to the Agreement to Lease; returns null when neither is found
 * (the caller then degrades to reading the first pages). Anchors on the FIRST
 * page of the chosen document and windows LEASE_WINDOW_PAGES forward (clamped to
 * the document end).
 */
export function locateLeasePages(pageTexts: string[]): LeaseLocation | null {
  const n = Math.min(pageTexts.length, MAX_SCAN_PAGES);
  let firstStandard = -1;
  let firstAgreement = -1;
  let firstCustom = -1;
  for (let i = 0; i < n; i++) {
    const cls = classifyLeasePage(pageTexts[i] ?? "");
    if (cls === "standard_lease" && firstStandard < 0) firstStandard = i;
    else if (cls === "agreement_to_lease" && firstAgreement < 0) firstAgreement = i;
    else if (cls === "custom_lease" && firstCustom < 0) firstCustom = i;
  }

  const total = pageTexts.length;
  // Priority: the binding Standard Lease, then the Agreement-to-Lease offer, then
  // a landlord's own custom agreement. A recognised form always wins regardless
  // of where it sits in the bundle.
  const pick =
    firstStandard >= 0
      ? { startPage: firstStandard, anchor: "standard_lease" as const }
      : firstAgreement >= 0
        ? { startPage: firstAgreement, anchor: "agreement_to_lease" as const }
        : firstCustom >= 0
          ? { startPage: firstCustom, anchor: "custom_lease" as const }
          : null;
  if (!pick) return null;
  return {
    startPage: pick.startPage,
    pageCount: Math.min(LEASE_WINDOW_PAGES, total - pick.startPage),
    anchor: pick.anchor,
  };
}

/** Human label for the located anchor (surfaced in the upload UI). */
export function leaseAnchorLabel(anchor: LeaseAnchor): string {
  if (anchor === "standard_lease") return "Standard Lease";
  if (anchor === "agreement_to_lease") return "Agreement to Lease";
  return "Lease agreement";
}
