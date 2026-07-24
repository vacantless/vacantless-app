// Pure "is this rental ready to share?" checklist. No DB / env / IO — the
// property detail page fetches the signals (the rental row, its photo count,
// the org's availability windows + reply-to) and passes them in, so this stays
// unit-testable (see scripts/test-share-readiness.ts).
//
// The checklist answers the QA question: before an operator copies a public
// listing link and pastes it onto Kijiji/Facebook, what's actually in place?
// Required checks gate "ready to share" (the link resolves AND the listing has
// the basics a renter needs to decide). Recommended checks are surfaced but
// never block — a Live, fully-described rental with no photos is still
// shareable, just weaker.

import { isPublicBookable } from "./listing-state";

export type ShareCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** Required checks gate readyToShare; recommended checks only inform. */
  required: boolean;
  /** Guidance shown when the check isn't satisfied. */
  hint: string;
};

export type ShareReadinessInput = {
  status: string;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  address: string | null;
  photoCount: number;
  availabilityWindowCount: number;
  replyToEmail: string | null;
};

export type ShareReadiness = {
  checks: ShareCheck[];
  /** Every required check passes — the link is safe + complete to hand out. */
  readyToShare: boolean;
  /** Every check (required + recommended) passes. */
  allMet: boolean;
  requiredOutstanding: number;
  recommendedOutstanding: number;
};

function hasText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositive(v: number | null | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Beds/baths can legitimately be 0 (a studio is 0 beds), so "set" = not null. */
function isSet(v: number | null | undefined): boolean {
  return v != null && Number.isFinite(v);
}

export function buildShareReadiness(
  input: ShareReadinessInput,
): ShareReadiness {
  const checks: ShareCheck[] = [
    {
      key: "live",
      label: "Listing is Live",
      ok: isPublicBookable(input.status),
      required: true,
      hint: "Use Set Live at the top of the page so its public link works and renters can inquire and book a viewing.",
    },
    {
      key: "address",
      label: "Address added",
      ok: hasText(input.address),
      required: true,
      hint: "Add the rental's address so renters know where it is.",
    },
    {
      key: "rent",
      label: "Rent set",
      ok: isPositive(input.rentCents),
      required: true,
      hint: "Set the monthly rent - it's the first thing renters filter on.",
    },
    {
      key: "beds_baths",
      label: "Beds and baths set",
      ok: isSet(input.beds) && isSet(input.baths),
      required: true,
      hint: "Add the bed and bath count so renters can tell if it fits.",
    },
    {
      key: "photos",
      label: "Photos added",
      ok: input.photoCount > 0,
      required: false,
      hint: "Add at least one photo. Listings with photos get far more inquiries - but you can share without them.",
    },
    {
      key: "viewing_times",
      label: "Viewing availability set",
      ok: input.availabilityWindowCount > 0,
      required: false,
      hint: "Set weekly viewing windows so renters can self-book a viewing online.",
    },
    {
      key: "reply_to",
      label: "Reply-to email set",
      ok: hasText(input.replyToEmail),
      required: false,
      hint: "Set a reply-to email in Settings so renter emails come from your address, not a generic sender.",
    },
  ];

  const requiredOutstanding = checks.filter((c) => c.required && !c.ok).length;
  const recommendedOutstanding = checks.filter(
    (c) => !c.required && !c.ok,
  ).length;

  return {
    checks,
    readyToShare: requiredOutstanding === 0,
    allMet: requiredOutstanding === 0 && recommendedOutstanding === 0,
    requiredOutstanding,
    recommendedOutstanding,
  };
}
