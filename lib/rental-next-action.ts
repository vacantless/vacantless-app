// ============================================================================
// Rental lifecycle spine — forward-derivation (IA Step 4, slice 3, S279).
//
// The IA audit (VACANTLESS-IA-AUDIT-2026-06-20.md §5.2, "the postal-code move")
// names the cascade as the place "dozens of clicks -> a couple" gets won: each
// step PRE-FILLS the next from what's already known, so the operator CONFIRMS
// rather than re-enters.
//   - the unit's facts + the building-standard-policy profile auto-fill setup;
//   - the listing + inquiries feed the viewing;
//   - the screening config + the inquiry feed the qualify view;
//   - the tenancy + building policy + clause library pre-fill the lease.
//
// Slice 1 (S278) shipped the read-only RAIL. This slice 3 derives, for the
// CURRENT step only, a concrete "next action": the values ALREADY filled in for
// the operator (derived facts — confirm, don't re-enter), the few GAPS still
// needing them, and one primary CTA. It is rendered as a card under the rail.
// Slice 2 (click-and-collapse, the 1738-line page restructure) is separate.
//
// Pure — no DOM / env / IO (see scripts/test-rental-next-action.ts).
// ============================================================================

import {
  type LifecycleStep,
} from "./rental-lifecycle";
import {
  acTypeLabel,
  leaseTermLabel,
  smokingLabel,
  type UnitFeatures,
} from "./property-features";

// A value already filled in for the operator. `inherited` = it came from the
// building/org standard-policy profile (not keyed on this unit) — the cascade.
export type NextActionFact = {
  key: string;
  label: string;
  value: string;
  inherited: boolean;
};

// Something the operator still has to supply on this step.
export type NextActionGap = { key: string; label: string };

export type NextAction = {
  step: LifecycleStep;
  /** Imperative headline for the current step. */
  title: string;
  /** One sentence naming the cascade ("we filled X; confirm + add Y"). */
  blurb: string;
  /** Values already derived/inherited — confirm, don't re-enter. */
  derived: NextActionFact[];
  /** What still needs the operator on this step. */
  gaps: NextActionGap[];
  /** Primary call-to-action for this step. */
  cta: { label: string; href: string };
};

// The effective (unit > building > org resolved) policy/feature values the
// setup + market cascade confirms. Subset of UnitFeatures the card displays.
export type NextActionPolicy = Pick<
  UnitFeatures,
  | "lease_term"
  | "smoking"
  | "ac_type"
  | "on_site_management"
  | "heat_included"
  | "hydro_included"
  | "water_included"
  | "pets_cats"
  | "pets_dogs"
>;

export type NextActionInput = {
  propertyId: string;
  currentStep: LifecycleStep | null;

  // --- set up -------------------------------------------------------------
  hasRent: boolean;
  bedsSet: boolean;
  bathsSet: boolean;
  /** Effective resolved policy/feature values (the cascade output). */
  effective: NextActionPolicy;
  /** Which field keys were INHERITED from the building/org profile (not the unit). */
  inherited: ReadonlySet<string>;

  // --- market -------------------------------------------------------------
  isLive: boolean;
  photoCount: number;
  /** Number of ready-to-paste channel copies built from this unit. */
  channelCount: number;

  // --- inquiries ----------------------------------------------------------
  /** Public link resolves (unit publicly visible). */
  linkIsLive: boolean;
  listingPostCount: number;

  // --- viewings -----------------------------------------------------------
  hasAvailability: boolean;
  /** Inquiries still open (not lost, not yet leased) — ready to move to a viewing. */
  openInquiryCount: number;

  // --- screen -------------------------------------------------------------
  applicantCount: number;
};

function includedWord(v: boolean | null | undefined): string | null {
  if (v === true) return "Included";
  if (v === false) return "Tenant pays";
  return null; // unset — not advertised, omit from the confirm list
}

function petWord(cats: boolean | null | undefined, dogs: boolean | null | undefined): string | null {
  if (cats == null && dogs == null) return null;
  if (cats && dogs) return "Cats & dogs welcome";
  if (cats) return "Cats welcome";
  if (dogs) return "Dogs welcome";
  return "No pets";
}

// Build the "already filled from your defaults" facts for the setup cascade.
// Each fact is shown so the operator confirms rather than re-keys; `inherited`
// drives the "from your building defaults" badge.
function policyFacts(
  e: NextActionPolicy,
  inherited: ReadonlySet<string>,
): NextActionFact[] {
  const facts: NextActionFact[] = [];
  const push = (key: string, label: string, value: string | null) => {
    if (value != null && value !== "")
      facts.push({ key, label, value, inherited: inherited.has(key) });
  };
  push("lease_term", "Lease term", leaseTermLabel(e.lease_term));
  push("smoking", "Smoking", smokingLabel(e.smoking));
  push("ac_type", "Air conditioning", acTypeLabel(e.ac_type));
  if (e.on_site_management != null)
    push(
      "on_site_management",
      "On-site management",
      e.on_site_management ? "Yes" : "No",
    );
  push("heat_included", "Heat", includedWord(e.heat_included));
  push("hydro_included", "Hydro", includedWord(e.hydro_included));
  push("water_included", "Water", includedWord(e.water_included));
  push("pets", "Pets", petWord(e.pets_cats, e.pets_dogs));
  return facts;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Derive the next action for a unit's CURRENT lifecycle step. Pure: same input
 * -> same output. Returns null when the unit is fully tenanted (no current
 * step) — the card is hidden then.
 *
 * The derivation mirrors the rail's frontier (rental-lifecycle.ts): whichever
 * step the rail marks "current" is the one we pre-fill here. The set-up + market
 * steps carry the real cascade (the building profile already filled the policy
 * fields + wrote the listing copy); the later steps mostly route, since their
 * pre-fill happens on the destination surface.
 */
export function deriveNextAction(input: NextActionInput): NextAction | null {
  const step = input.currentStep;
  if (step === null) return null;

  const self = `/dashboard/properties/${input.propertyId}`;
  const facts = policyFacts(input.effective, input.inherited);
  const inheritedCount = facts.filter((f) => f.inherited).length;

  switch (step) {
    case "set_up": {
      // Only surface a gap for a field that's actually still missing. set_up is
      // current until rent + beds + baths are all set (mirrors lib/rental-lifecycle),
      // so any subset of these can be the outstanding one.
      const gaps: NextActionGap[] = [];
      if (!input.hasRent) gaps.push({ key: "rent", label: "Monthly rent" });
      if (!input.bedsSet) gaps.push({ key: "beds", label: "Bedrooms" });
      if (!input.bathsSet) gaps.push({ key: "baths", label: "Bathrooms" });
      const blurb =
        inheritedCount > 0
          ? `${plural(
              inheritedCount,
              "detail is",
              "details are",
            )} already filled from your building defaults. Confirm them and add the few things below.`
          : "Add the property's rental details below. Set your building defaults once and future units inherit them automatically.";
      return {
        step,
        title: "Finish setting up this property",
        blurb,
        derived: facts,
        gaps,
        cta: { label: "Add property details", href: `${self}#rental-details` },
      };
    }

    case "market": {
      const gaps: NextActionGap[] = [];
      if (input.photoCount === 0)
        gaps.push({ key: "photos", label: "Add at least one photo" });
      if (!input.isLive)
        gaps.push({ key: "live", label: "Set the rental to Live" });
      const derived: NextActionFact[] = [];
      if (input.channelCount > 0)
        derived.push({
          key: "copy",
          label: "Listing copy",
          value: `Written for ${plural(input.channelCount, "channel", "channels")}`,
          inherited: false,
        });
      if (inheritedCount > 0)
        derived.push({
          key: "policy",
          label: "Listing details",
          value: `${plural(
            inheritedCount,
            "field",
            "fields",
          )} from your building defaults`,
          inherited: true,
        });
      return {
        step,
        title: "Set this property Live",
        blurb:
          "Your listing is written from these details and your building defaults. Finish the steps below to take it live.",
        derived,
        gaps,
        cta:
          input.photoCount === 0
            ? { label: "Add photos", href: `${self}#property-photos` }
            : { label: "Set it Live", href: `${self}#publish-action` },
      };
    }

    case "inquiries": {
      const derived: NextActionFact[] = [];
      if (input.linkIsLive)
        derived.push({
          key: "link",
          label: "Public page",
          value: "Live — inquiries land in your renter list",
          inherited: false,
        });
      if (input.listingPostCount > 0)
        derived.push({
          key: "posts",
          label: "Posted",
          value: plural(input.listingPostCount, "channel", "channels"),
          inherited: false,
        });
      return {
        step,
        title: "Market this property",
        blurb:
          "Your property is live. Use the distribution checklist to post where renters look and track which channels bring leads back.",
        derived,
        gaps:
          input.listingPostCount === 0
            ? [{ key: "market", label: "Post to your first channel" }]
            : input.openInquiryCount === 0
              ? [{ key: "market", label: "Refresh or add a renter channel" }]
              : [{ key: "share", label: "Share the link with more renters" }],
        cta: { label: "Open marketing checklist", href: `${self}#distribute-header` },
      };
    }

    case "viewings": {
      if (!input.hasAvailability)
        return {
          step,
          title: "Open viewing times",
          blurb:
            "Renters can self-book once you set weekly viewing windows — then inquiries flow straight into booked showings.",
          derived: [],
          gaps: [{ key: "availability", label: "Set your viewing windows" }],
          cta: {
            label: "Set viewing times",
            href: "/dashboard/availability",
          },
        };
      return {
        step,
        title: "Book a viewing",
        blurb:
          input.openInquiryCount > 0
            ? `${plural(
                input.openInquiryCount,
                "inquiry is",
                "inquiries are",
              )} ready to move to a viewing.`
            : "Viewing times are set — renters can self-book, and you can invite an inquiry to a showing.",
        derived: input.hasAvailability
          ? [
              {
                key: "availability",
                label: "Viewing times",
                value: "Open for self-booking",
                inherited: false,
              },
            ]
          : [],
        gaps:
          input.openInquiryCount > 0
            ? [{ key: "book", label: "Invite an inquiry to a viewing" }]
            : [],
        cta: { label: "Go to viewings", href: "/dashboard/showings" },
      };
    }

    case "screen": {
      return {
        step,
        title: "Screen applicants",
        blurb:
          input.applicantCount > 0
            ? `${plural(
                input.applicantCount,
                "application is",
                "applications are",
              )} in. Review them against your screening criteria.`
            : "Review applicants against the screening criteria you set once — applied to every rental.",
        derived: [],
        gaps:
          input.applicantCount > 0
            ? [{ key: "review", label: "Review applications" }]
            : [],
        cta: {
          label: "Review screening",
          href: "/dashboard/leasing/screening",
        },
      };
    }

    case "lease": {
      return {
        step,
        title: "Prepare the lease",
        blurb:
          "The tenancy, your building policy, and your clause library pre-fill the lease paperwork — review and send.",
        derived: facts.length
          ? [
              {
                key: "policy",
                label: "Lease terms",
                value: `${plural(
                  facts.length,
                  "detail",
                  "details",
                )} ready from your defaults`,
                inherited: inheritedCount > 0,
              },
            ]
          : [],
        gaps: [{ key: "lease", label: "Create the lease & send for signing" }],
        // S282 (IA G8 fix): act on THIS unit — the lease step is frontier only
        // before a tenancy exists, so route to the new-tenancy form pre-filled
        // for this property, not the cross-unit hub.
        cta: {
          label: "Create the lease",
          href: `/dashboard/tenancies/new?property=${input.propertyId}`,
        },
      };
    }

    case "tenanted":
      // tenanted is only "current" transiently; the rail marks it done once the
      // unit is Leased. No outstanding action.
      return {
        step,
        title: "Move the tenant in",
        blurb: "Confirm the tenancy and set up rent collection.",
        derived: [],
        gaps: [{ key: "tenancy", label: "Confirm the tenancy" }],
        cta: {
          label: "Set up the tenancy",
          href: `/dashboard/tenancies/new?property=${input.propertyId}`,
        },
      };
  }
}
