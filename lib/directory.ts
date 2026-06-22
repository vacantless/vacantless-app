// Pure trades-directory domain model (no I/O) so it can be unit-tested in
// isolation. The directory is the "local network of trusted trades" layered on
// top of the owner's private trade_contacts rolodex (migration 0054). See
// migration 0055 and VACANTLESS-TRADES-DIRECTORY-MODULE-SPEC-2026-06-22.md.
//
// The whole module is shaped by ONE guardrail: the owner stays the one who
// chooses, contracts, and pays the trade. The directory is a phonebook + a
// handoff, never a dispatcher-and-payer. So this file is about PROVENANCE
// (where a listing came from), PII MINIMIZATION (what is safe to show across
// orgs), and RANKING — never about scheduling or money.
//
// Three things this file enforces that matter for liability + privacy:
//   1. provenanceLabel keeps "trusted" framing FACTUAL — we never imply we
//      vetted a trade we did not (verified badge only when actually verified).
//   2. minimizeForDirectory drops everything not in the public set (and NEVER
//      copies a private note) when promoting a rolodex row into the directory.
//   3. canRevealContact / publicListingView keep phone + email out of the
//      default cross-org read — contact is revealed only on add / intro / when
//      the trade self-lists it public.
//
// Customer-facing strings use hyphens, not em dashes (project copy rule).

// --- Value sets -------------------------------------------------------------

// Where a listing came from. Mirrors the directory_trades.source CHECK in 0055.
//   landlord — promoted from a landlord's private trade_contacts rolodex
//   self     — the trade signed itself up (Slice 3)
//   curated  — Vacantless added it (Slice 4)
export const DIRECTORY_SOURCES = ["landlord", "self", "curated"] as const;
export type DirectorySource = (typeof DIRECTORY_SOURCES)[number];

const SOURCE_LABELS: Record<DirectorySource, string> = {
  landlord: "Added by a landlord",
  self: "Self-listed",
  curated: "Added by Vacantless",
};

export function isDirectorySource(value: string): value is DirectorySource {
  return (DIRECTORY_SOURCES as readonly string[]).includes(value);
}

export function directorySourceLabel(source: string): string {
  return (SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

// --- Provenance / "trusted" framing (the factual-claim rule, tested) --------
//
// Public provenance must be honest about where trust comes from, so we never
// take on vouching liability for a trade we did not vet:
//   - verified (curated + vetted) -> "Vacantless-verified"
//   - landlord, used by others    -> "Used by N landlords near you" (social proof)
//   - landlord, not yet used       -> "Listed by a landlord near you"
//   - self                         -> "Self-listed - not yet verified by Vacantless"
//
// `verified` is passed separately from `source` because it is a distinct DB
// column — a listing is only "Vacantless-verified" when we actually set that
// flag, never just because source === 'curated'.
export function provenanceLabel(
  source: string,
  usedCount: number,
  verified: boolean = false,
): string {
  if (verified) return "Vacantless-verified";
  const count = Number.isFinite(usedCount) && usedCount > 0 ? Math.floor(usedCount) : 0;
  if (source === "landlord") {
    if (count <= 0) return "Listed by a landlord near you";
    const noun = count === 1 ? "landlord" : "landlords";
    return `Used by ${count} ${noun} near you`;
  }
  if (source === "self") return "Self-listed - not yet verified by Vacantless";
  if (source === "curated") return "Added by Vacantless";
  // Unknown source: fall back to a neutral, non-vouching label.
  return "Listed on Vacantless";
}

// --- Validation -------------------------------------------------------------

// Light email check, identical to validateTradeContactInput in lib/work-orders
// so the directory and the rolodex agree on what an email looks like.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type DirectoryListingInput = {
  businessName: string;
  tradeType?: string | null;
  serviceArea?: string | null;
  blurb?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type DirectoryListingValue = {
  businessName: string;
  tradeType: string | null;
  serviceArea: string | null;
  blurb: string | null;
  phone: string | null;
  email: string | null;
};

export type DirectoryListingValidation =
  | { ok: true; value: DirectoryListingValue }
  | { ok: false; code: string };

/**
 * Validate a directory-listing submission (used by both the promote-from-rolodex
 * path and the public self-registration path). Business name is required; email,
 * if present, must look like an email; everything else is light-trimmed free
 * text. Blank strings normalize to null.
 */
export function validateDirectoryListingInput(
  v: DirectoryListingInput,
): DirectoryListingValidation {
  const businessName = (v.businessName ?? "").trim();
  if (!businessName) return { ok: false, code: "business_name" };

  const email = (v.email ?? "").trim();
  if (email && !EMAIL_RE.test(email)) return { ok: false, code: "email" };

  const norm = (s: string | null | undefined): string | null => {
    const t = (s ?? "").trim();
    return t === "" ? null : t;
  };

  return {
    ok: true,
    value: {
      businessName,
      tradeType: norm(v.tradeType),
      serviceArea: norm(v.serviceArea),
      blurb: norm(v.blurb),
      phone: norm(v.phone),
      email: email || null,
    },
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  business_name: "Enter the trade's business name.",
  email: "Enter a valid email address, or leave it blank.",
  not_opted_in: "This trade has not been listed in the network.",
  forbidden: "You don't have permission to manage the trades directory.",
  notfound: "That directory listing could not be found.",
  already_listed: "This trade is already listed in the network.",
};

export function directoryErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

// --- Minimization (promote a private rolodex row -> public listing) ---------
//
// The cross-org-readable row exposes business name + trade type + service area
// + a short blurb ONLY. We deliberately do NOT carry the private `note` across,
// and contact (phone/email) is stored but withheld from the default read (see
// canRevealContact). This is what keeps a casual cross-org read from being a
// contact-scraping vector.

export type RolodexTrade = {
  name: string;
  trade_type?: string | null;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  // Optional region hint; trade_contacts has no service_area column today, so
  // callers may pass one through (e.g. the org's market) at promote time.
  service_area?: string | null;
};

export type MinimizedListing = {
  businessName: string;
  tradeType: string | null;
  serviceArea: string | null;
  blurb: string | null;
  // Contact is carried so the row can reveal it on add, but it is NEVER part of
  // the default cross-org read (publicListingView strips it). `note` is dropped
  // entirely — private rolodex notes never enter the directory.
  phone: string | null;
  email: string | null;
};

/**
 * Map a private rolodex trade to the minimized directory listing fields.
 * Drops the private `note`. Blank strings normalize to null.
 */
export function minimizeForDirectory(trade: RolodexTrade): MinimizedListing {
  const norm = (s: string | null | undefined): string | null => {
    const t = (s ?? "").trim();
    return t === "" ? null : t;
  };
  return {
    businessName: (trade.name ?? "").trim(),
    tradeType: norm(trade.trade_type),
    serviceArea: norm(trade.service_area),
    blurb: null, // a promoted listing starts with no marketing blurb
    phone: norm(trade.phone),
    email: norm(trade.email),
  };
}

// --- PII reveal rule --------------------------------------------------------

export type DirectoryListing = {
  id: string;
  source: string;
  business_name: string;
  trade_type: string | null;
  service_area: string | null;
  blurb: string | null;
  phone: string | null;
  email: string | null;
  contact_public: boolean;
  verified: boolean;
  used_count: number;
};

/**
 * Whether a viewer may see a listing's phone/email. Contact is revealed when:
 *   - the listing is marked contact_public (the trade self-listed it public), OR
 *   - the viewer has added the trade to their rolodex / requested an intro.
 * Until then, only business name + trade type + area are shown.
 */
export function canRevealContact(
  listing: Pick<DirectoryListing, "contact_public">,
  isAdded: boolean,
): boolean {
  return listing.contact_public === true || isAdded === true;
}

export type PublicListing = Omit<DirectoryListing, "phone" | "email"> & {
  phone: string | null;
  email: string | null;
  provenance: string;
};

/**
 * Project a stored directory row into the safe shape to send to a cross-org
 * viewer. Strips phone/email unless canRevealContact, and attaches the factual
 * provenance label. This is the function a server read should map rows through
 * before returning them to a different org.
 */
export function publicListingView(
  listing: DirectoryListing,
  isAdded: boolean = false,
): PublicListing {
  const reveal = canRevealContact(listing, isAdded);
  return {
    ...listing,
    phone: reveal ? listing.phone : null,
    email: reveal ? listing.email : null,
    provenance: provenanceLabel(listing.source, listing.used_count, listing.verified),
  };
}

// --- Ranking ----------------------------------------------------------------

/** Case-insensitive, whitespace-tolerant region match (substring either way). */
export function serviceAreaMatches(
  area: string | null | undefined,
  ownerArea: string | null | undefined,
): boolean {
  const a = (area ?? "").trim().toLowerCase();
  const o = (ownerArea ?? "").trim().toLowerCase();
  if (!a || !o) return false;
  return a === o || a.includes(o) || o.includes(a);
}

/**
 * Rank directory listings for an owner: same service area first, then verified,
 * then most-used (the proof-loop flywheel), then business name A-Z as a stable
 * tiebreak. Pure — returns a new array, does not mutate the input.
 */
export function rankListings<
  T extends Pick<DirectoryListing, "service_area" | "verified" | "used_count" | "business_name">,
>(listings: readonly T[], ownerServiceArea: string | null = null): T[] {
  return [...listings].sort((a, b) => {
    const am = serviceAreaMatches(a.service_area, ownerServiceArea) ? 1 : 0;
    const bm = serviceAreaMatches(b.service_area, ownerServiceArea) ? 1 : 0;
    if (am !== bm) return bm - am;

    const av = a.verified ? 1 : 0;
    const bv = b.verified ? 1 : 0;
    if (av !== bv) return bv - av;

    const au = Number.isFinite(a.used_count) ? a.used_count : 0;
    const bu = Number.isFinite(b.used_count) ? b.used_count : 0;
    if (au !== bu) return bu - au;

    return (a.business_name ?? "").localeCompare(b.business_name ?? "");
  });
}
