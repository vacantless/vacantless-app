// ============================================================================
// Per-portal "before you post" guardrails — the trust on-ramp ahead of any
// auto-fill (S260, the S259 Q4 decision). Pure data + selectors, no DOM / env /
// IO, fully unit-testable (see scripts/test-listing-guardrails.ts).
//
// This is CONTENT, not automation: it warns the operator about the documented
// per-portal traps BEFORE they post by hand, so it carries none of the ToS /
// Web-Store risk a DOM-injecting fill would. Sourced from the Pillette launch
// gotchas (PILLETTE-CLASSIFIEDS-POSTING-GOTCHAS-2026-06-14) + the per-portal
// feedback memories. Keyed on the SAME PortalKey taxonomy as listing
// distribution so the checklist and the "Where this is posted" tracker never
// drift apart.
// ============================================================================

import { isPortalKey, type PortalKey } from "./listing-distribution";

// Severity drives both the sort order and the visual treatment. `critical` =
// costs money or is irreversible if missed; `warning` = wrong contact / dead
// link / blocked checkout; `tip` = smoother-if-you-know-it.
export const GUARDRAIL_SEVERITIES = ["critical", "warning", "tip"] as const;
export type GuardrailSeverity = (typeof GUARDRAIL_SEVERITIES)[number];

// Lower number = more urgent; used to sort a portal's guardrails.
const SEVERITY_RANK: Record<GuardrailSeverity, number> = {
  critical: 0,
  warning: 1,
  tip: 2,
};

export type Guardrail = {
  /** Stable id (portal-scoped) so a checklist can track checked state. */
  id: string;
  severity: GuardrailSeverity;
  /** Short, imperative checklist line. */
  title: string;
  /** The why / how behind the line. */
  detail: string;
};

// --- portal-specific traps --------------------------------------------------
// Order within each array is authored most-urgent-first; guardrailsForPortal()
// re-sorts by severity defensively so editing order can't break the UI.

const KIJIJI: Guardrail[] = [
  {
    id: "kijiji-location-lock",
    severity: "critical",
    title: "Confirm the location reads Windsor — not Toronto — before you pay.",
    detail:
      "A paid Kijiji ad's location is LOCKED once posted and cannot be edited. The form silently defaults to the Toronto account address (3800 Yonge St), so set postal code N8Y 3B4 and confirm the map shows Windsor right before paying. After posting, open the live ad and check the URL slug says windsor-area-on, not city-of-toronto. The only fix for a mis-located ad is delete + repost.",
  },
  {
    id: "kijiji-lite-plus-reset",
    severity: "critical",
    title: "Re-click the Lite ($29.95) plan right before you pay.",
    detail:
      "On the submit reload Kijiji silently reverts the package from Lite to Plus ($95+). Scroll back to the package cards, re-select Lite, and confirm the total reads $29.95 (~$33.84 with HST) before paying. Re-check after any cart edit too.",
  },
  {
    id: "kijiji-required-fields",
    severity: "warning",
    title: "Set Size (sqft) and Parking Included up front.",
    detail:
      "Size and Parking errors only surface on submit and block checkout. Also fill Unit Type, Bedrooms, Bathrooms, and Agreement Type. Pick the category manually — Real Estate › For Rent › Long Term Rentals — because the suggested \"Houses for Sale\" is wrong.",
  },
  {
    id: "kijiji-cart-leftovers",
    severity: "warning",
    title: "Clear any leftover draft ads from the cart before checkout.",
    detail:
      "Old draft ads can sit in the cart and get paid for alongside the new one. Remove unwanted items before Proceed to Checkout.",
  },
  {
    id: "kijiji-title-limit",
    severity: "tip",
    title: "Keep the ad title under 64 characters.",
    detail:
      "Kijiji caps the title at ~64 characters; longer titles get truncated or rejected.",
  },
];

const RENTALS_CA: Guardrail[] = [
  {
    id: "rentalsca-disabled-default",
    severity: "critical",
    title: "After posting, open Manage Listings and click Enable.",
    detail:
      "Rentals.ca saves new listings as Disabled. The listing is NOT live until you go to Manage Listings, find the card (badge = Disabled), click Enable, and confirm the badge turns green / Active. It's a two-step publish.",
  },
  {
    id: "rentalsca-lead-contact-revert",
    severity: "critical",
    title: "Reset the Lead Contact to rentals@agileonline.ca + 226-773-7555.",
    detail:
      "The per-listing Lead Contact defaults wrong to thadmusco@gmail.com and a Toronto (416) phone. Triple-click each field and set the Agile contact before publishing, or inquiries route to the wrong place.",
  },
  {
    id: "rentalsca-free-cap",
    severity: "warning",
    title: "Check you have a free slot — the Limited plan caps at 3 active listings.",
    detail:
      "The free Limited plan allows only 3 active listings at a time. The $0 card still shows on a 4th listing, but it won't publish. If you're already at 3, open Manage Listings › Active and Disable one first to free a slot (Disable is reversible — Enable restores it; it is NOT a delete). Check this before you start so you're not blocked at the end.",
  },
  {
    id: "rentalsca-paid-default",
    severity: "warning",
    title: "Click \"See other pricing options\" → Limited $0 to stay free.",
    detail:
      "The plan step defaults to paid Promoted plans ($35-89) with a +$20 Credit Report add-on pre-checked. Choose the free Limited $0 plan unless you actually mean to pay — and if you do pick a paid plan, uncheck the +$20 Credit Report first.",
  },
  {
    id: "rentalsca-parking-included",
    severity: "warning",
    title: "Set Parking Included = No unless it's truly in the rent.",
    detail:
      "Step 2 has a Parking block with an Included? toggle. Default it to No: advertising parking as included in rent is a commitment that's hard to walk back, and you usually want to offer a spot as a per-unit add-on instead. Set the Parking Type, but leave Included off unless every tenant genuinely gets a spot in the base rent.",
  },
  {
    id: "rentalsca-free-expiry",
    severity: "tip",
    title: "Free Limited listings expire after 21 days — rotate them.",
    detail:
      "A free Limited listing drops off after 21 days (paid Promoted plans run 15 / 30 / 60 days). Re-post or rotate your free listings roughly every 3 weeks — this is also the natural moment to swap in a held unit so the slot keeps working.",
  },
  {
    id: "rentalsca-address-autocomplete",
    severity: "tip",
    title: "Pick the Google autocomplete suggestion for the address.",
    detail:
      "The first keystroke often doesn't register and the page auto-scrolls. Click the field again, retype, and pick the dropdown match so the address geocodes correctly.",
  },
  {
    id: "rentalsca-description-bullets",
    severity: "tip",
    title: "Write the description as flowing sentences, not dashed lines.",
    detail:
      "The rich-text editor auto-bullets each line, so a leading \"- \" produces ugly \"• -\" double markers.",
  },
];

const RENTFASTER: Guardrail[] = [
  {
    id: "rentfaster-paid-sixty-day",
    severity: "critical",
    title: "Confirm the paid 60-day ad cost before you submit.",
    detail:
      "RentFaster prices a single-unit new rental ad at $54.50 plus tax and says it posts for 60 days. Confirm the checkout total and that this channel is worth the spend before paying.",
  },
  {
    id: "rentfaster-single-address",
    severity: "warning",
    title: "Use one single-unit ad per address unless this is a true multi-unit listing.",
    detail:
      "The single-unit ad is valid for one address. RentFaster's multi-unit option is for one address with up to 7 unit types, usually an apartment block. Do not bundle unrelated addresses into one ad.",
  },
  {
    id: "rentfaster-location-market",
    severity: "warning",
    title: "Check the city and map market before paying.",
    detail:
      "RentFaster search is city and map driven. Confirm the address geocodes to the right city or nearby market before you pay, especially for Ontario listings outside its western-Canada core.",
  },
  {
    id: "rentfaster-reactivate",
    severity: "tip",
    title: "Reactivate an old matching ad instead of creating a fresh one when possible.",
    detail:
      "RentFaster stores deactivated ads and lists a lower reactivation price than a new rental ad. If this exact address was listed before, check My Listings first.",
  },
  {
    id: "rentfaster-photo-depth",
    severity: "tip",
    title: "Use the full photo set and a complete description.",
    detail:
      "RentFaster's single-unit ad includes unlimited photos and description, so do not hold back the unit-specific photos that help renters decide quickly.",
  },
];

const ZUMPER: Guardrail[] = [
  {
    id: "zumper-url-strip",
    severity: "warning",
    title: "Don't rely on a booking link in the description — Zumper strips URL punctuation.",
    detail:
      "Zumper removes the \":\", \"/\", and \".\" from links, so a pasted booking URL renders dead. The phone number survives, and Zumper routes inquiries to the account email, so lead capture still works — just don't count on a tracked link for Zumper.",
  },
  {
    id: "zumper-identity-gates",
    severity: "warning",
    title: "First-time setup needs phone + government-ID verification (one-time).",
    detail:
      "A new Zumper account must upgrade to Manage, verify a phone by SMS, and pass Persona ID + selfie verification before it can list. These gates are one-time per account and have to be done by a person.",
  },
  {
    id: "zumper-address-autocomplete",
    severity: "warning",
    title: "Pick the Google autocomplete suggestion for the Street Address.",
    detail:
      "Zumper geocodes off the autocomplete pick — typing a bare address and moving on throws \"This address does not include a valid zip code\" and blocks Step 1. Click the field, type, and select the dropdown match. The unit/suite goes in the separate Apt/Unit # field.",
  },
  {
    id: "zumper-sqft-required",
    severity: "warning",
    title: "Square footage is required — Zumper won't advance without it.",
    detail:
      "Unlike most portals, Zumper makes Size a required numeric field on the Listing details step, so an unknown-size unit blocks you mid-wizard. When the unit has no real size, the fill sheet drops in a conservative bed-count estimate (biased low so it's never overstated) and adds \"approximate square footage\" to the description — replace it with the actual size whenever you know it.",
  },
  {
    id: "zumper-boost-upsell",
    severity: "tip",
    title: "Click \"Continue without Boost\" — the free tier still reaches PadMapper.",
    detail:
      "The publish step upsells a paid Boost (~$30 USD/30 days). The free tier already syndicates to Zumper + PadMapper, so skip it unless you want the priority placement.",
  },
  {
    id: "zumper-rent-override",
    severity: "tip",
    title: "Override Zumper's suggested rent with your actual price.",
    detail:
      "Zumper pre-suggests a higher area-average rent; type your real monthly rent over it.",
  },
];

const FACEBOOK: Guardrail[] = [
  {
    id: "facebook-manual-only",
    severity: "critical",
    title: "Post and reply by hand — Facebook Marketplace has no listing feed.",
    detail:
      "Meta ended all third-party rental partner feeds in September 2021. There is no API and no feed onto Marketplace; every post and every reply is manual on a personal profile. Don't promise or plan around automation here.",
  },
  {
    id: "facebook-edit-in-place",
    severity: "warning",
    title: "Edit an existing ad instead of reposting.",
    detail:
      "Editing in place keeps the click history and avoids the ID-verification cooldown that rapid reposting triggers (a 48-hour hidden penalty). Pace new posts to about one a day.",
  },
  {
    id: "facebook-links-in-dms",
    severity: "warning",
    title: "Don't paste a booking link in DMs — it won't be clickable.",
    detail:
      "Facebook breaks links in Marketplace messages (both clicking and copying fail). Use the QR-code-as-photo + two-message pattern, or just share the phone number.",
  },
  {
    id: "facebook-unique-photos",
    severity: "warning",
    title: "Use a unique photo set and vary the price, title, and copy per ad.",
    detail:
      "Address and photo overlap across ads is the top anti-fraud trigger. Give each ad a fully distinct photo set (md5-verify zero overlap) and vary the wording.",
  },
  {
    id: "facebook-list-view-lag",
    severity: "tip",
    title: "Trust the in-editor Preview, not the Selling-list thumbnails.",
    detail:
      "List-view thumbnails and prices lag for minutes after an edit. Confirm changes in the editor Preview, not the Selling list.",
  },
];

const VIEWIT: Guardrail[] = [
  {
    id: "viewit-paid-not-free",
    severity: "critical",
    title: "Viewit is paid (~$62/mo incl. tax) — confirm the Windsor reach is worth it.",
    detail:
      "Viewit.ca is a $54.95/month subscription, not free. It's Toronto-skewed with lower Windsor reach, so for paid dollars a second Kijiji Lite ad (~$30) usually outperforms it. Treat any Viewit run as a measured test.",
  },
  {
    id: "viewit-geocode",
    severity: "warning",
    title: "Pick the Google Places dropdown suggestion for the address.",
    detail:
      "The street field mis-geocodes unless you select the autocomplete match (it auto-filled a Tara, ON address until corrected). Intersection 1 and Intersection 2 are both required.",
  },
];

const REALTOR_CA: Guardrail[] = [
  {
    id: "realtorca-ddf-only",
    severity: "tip",
    title: "Realtor.ca rentals flow through your brokerage's MLS/DDF feed, not a manual post.",
    detail:
      "Realtor.ca only accepts listings from REALTOR members via the DDF feed. There's no self-serve manual post; route it through your brokerage's MLS entry.",
  },
];

// --- universal traps (apply to EVERY portal) --------------------------------
// Appended after the portal-specific list. Grounded in the disclosure +
// exterior-photo + tracked-link memories.

const UNIVERSAL: Guardrail[] = [
  {
    id: "universal-disclosures",
    severity: "warning",
    title: "State that hydro is not included and suites are unfurnished.",
    detail:
      "Every listing must disclose that hydro is not included and the unit is unfurnished, so inquiries arrive already expecting the terms.",
  },
  {
    id: "universal-exterior-photo",
    severity: "warning",
    title: "Verify the lead exterior photo actually matches this address.",
    detail:
      "Before publishing, confirm the cover/exterior shot is this building — a mismatched exterior is the kind of error that's costly to undo on a paid ad.",
  },
  {
    id: "universal-tracked-link",
    severity: "tip",
    title: "Share this portal's tracked link, not the plain listing URL.",
    detail:
      "The tracked link tags every inquiry with the channel it came from, so your reports show which portals actually convert. (Zumper and FB DMs are the two exceptions where the link can't carry through.)",
  },
];

// One source of truth for the per-portal lists.
const PORTAL_GUARDRAILS: Record<PortalKey, Guardrail[]> = {
  kijiji: KIJIJI,
  facebook: FACEBOOK,
  rentals_ca: RENTALS_CA,
  rentfaster: RENTFASTER,
  zumper: ZUMPER,
  viewit: VIEWIT,
  realtor_ca: REALTOR_CA,
  other: [],
};

/**
 * The full "before you post" checklist for a portal: its specific traps
 * (sorted critical → warning → tip), then the universal disclosures/photo/link
 * reminders that apply everywhere. Unknown/junk keys fall back to "other", so
 * the operator still gets the universal checklist rather than an empty card.
 */
export function guardrailsForPortal(key: unknown): Guardrail[] {
  const portal: PortalKey = isPortalKey(key) ? key : "other";
  const specific = [...(PORTAL_GUARDRAILS[portal] ?? [])].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  return [...specific, ...UNIVERSAL];
}

/** How many of a portal's guardrails are at the given severity. */
export function countBySeverity(
  guardrails: ReadonlyArray<Guardrail>,
  severity: GuardrailSeverity,
): number {
  return guardrails.reduce((n, g) => (g.severity === severity ? n + 1 : n), 0);
}

/** True when a portal has at least one critical, money-or-irreversible trap. */
export function hasCritical(key: unknown): boolean {
  return guardrailsForPortal(key).some((g) => g.severity === "critical");
}

const SEVERITY_LABELS: Record<GuardrailSeverity, string> = {
  critical: "Critical",
  warning: "Watch out",
  tip: "Tip",
};

/** Operator-facing label for a severity (badge / sr-only text). */
export function severityLabel(severity: unknown): string {
  return GUARDRAIL_SEVERITIES.includes(severity as GuardrailSeverity)
    ? SEVERITY_LABELS[severity as GuardrailSeverity]
    : "Tip";
}
