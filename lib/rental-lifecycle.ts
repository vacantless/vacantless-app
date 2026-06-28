// ============================================================================
// Rental lifecycle spine — the progress rail (IA Step 4, slice 1, S278).
//
// The IA audit (VACANTLESS-IA-AUDIT-2026-06-20.md §5.2) names the rental as the
// lifecycle spine: one surface carrying a unit empty -> leased, with a visible
// progress rail ("you're here; this is what's left") — Tesla principle #3.
//
// This module is slice 1: a PURE, read-only derivation of where a unit sits in
// its lifecycle and what each step's status is. It introduces NO new query —
// every input is already fetched by app/dashboard/properties/[id]/page.tsx
// (property status, photo count, listing posts, leads-by-status, availability).
// Later slices (click-and-collapse sections, forward-derivation) build on this
// skeleton.
//
// Pure — no DOM / env / IO (see scripts/test-rental-lifecycle.ts).
// ============================================================================

import {
  isPubliclyVisible,
  propertyStatusLabel,
  type PropertyStatus,
} from "./listing-state";
import { type LeadStatus } from "./pipeline";

// The seven stages of a unit's life, in order. Mirrors the rail in the audit:
//   [Set up] -> [Market] -> [Inquiries] -> [Viewings] -> [Screen] -> [Lease] -> [Tenanted]
export const LIFECYCLE_STEPS = [
  "set_up",
  "market",
  "inquiries",
  "viewings",
  "screen",
  "lease",
  "tenanted",
] as const;

export type LifecycleStep = (typeof LIFECYCLE_STEPS)[number];

// A unit's tenancy status (mirrors tenancies.status). This — not lead.status —
// is the authoritative "is there a lease / is a tenant in place" signal.
export type TenancyLifecycleStatus = "upcoming" | "active" | "ended";

// "done"    = the operator is past this step (progress has moved beyond it)
// "current" = the frontier — the earliest step not yet satisfied; act here next
// "todo"    = still ahead
export type LifecycleStepState = "done" | "current" | "todo";

const STEP_LABELS: Record<LifecycleStep, string> = {
  set_up: "Set up",
  market: "Market",
  inquiries: "Inquiries",
  viewings: "Viewings",
  screen: "Screen",
  lease: "Lease",
  tenanted: "Tenanted",
};

export function lifecycleStepLabel(step: LifecycleStep): string {
  return STEP_LABELS[step];
}

// Where the lead pipeline sits relative to the rail. A lead at any of these
// stages is evidence the unit has reached that part of its life.
const LEAD_RANK: Record<LeadStatus, number> = {
  new: 1,
  replied: 1,
  contacted: 1,
  booked: 2, // a viewing is booked
  showed: 3, // a viewing happened
  applied: 4, // an application is in
  leased: 5, // a lease is signed
  lost: 0, // dropped — counts as an inquiry, but no forward progress
};

export type RentalLifecycleInput = {
  /** properties.status (draft | available | paused | leased | off_market). */
  propertyStatus: PropertyStatus;
  /** rent_cents is set and positive — the unit's core money fact is entered. */
  hasRent: boolean;
  /** property_photos count. */
  photoCount: number;
  /** listing_posts count (where the unit is posted). */
  listingPostCount: number;
  /** org has at least one weekly viewing window so renters can self-book. */
  hasAvailability: boolean;
  /** leads.status for every inquiry on this unit. */
  leadStatuses: LeadStatus[];
  /**
   * The tenancy record for this unit, if one exists (active preferred, else
   * most recent). Lets the Lease/Tenanted steps deep-link into THIS unit's
   * tenancy instead of dumping the operator at the cross-unit hub — the spine's
   * "act on one unit" promise, kept through the lease step (S282, IA G8 fix).
   * Null/omitted = no tenancy yet → the steps route to the pre-filled
   * "new tenancy" form for this property (the forward-derivation cascade).
   */
  tenancyId?: string | null;
  /**
   * The status of the chosen tenancy (active preferred, else upcoming, else the
   * most recent ended one). This is the AUTHORITATIVE lease/tenanted signal: an
   * actual tenancy record — not lead.status — proves a lease exists, and an
   * `active` tenancy proves a tenant is in place. Only `active`/`upcoming`
   * tenancies count as forward lifecycle progress; an `ended`-only tenancy means
   * the unit is between tenants and the rail derives from its re-marketing state.
   * Null/omitted = no tenancy.
   */
  tenancyStatus?: TenancyLifecycleStatus | null;
};

export type LifecycleStepResult = {
  step: LifecycleStep;
  label: string;
  state: LifecycleStepState;
  /** Short status line shown under the step. */
  detail: string;
  /** Deep-link into the surface where this step's work happens. */
  href: string;
};

export type RentalLifecycle = {
  steps: LifecycleStepResult[];
  /** The frontier step to act on next; null when the unit is fully tenanted. */
  currentStep: LifecycleStep | null;
  /** How many steps are "done". */
  completedCount: number;
  totalCount: number;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Derive the lifecycle rail for one unit. Pure: same input -> same output.
 *
 * Each step has a raw "satisfied" predicate from the inputs. We then make the
 * rail monotone from the back — a later satisfied step implies every earlier
 * step is satisfied (you cannot have a tenant without having set the unit up),
 * which gracefully handles out-of-order evidence (e.g. a unit marked Leased
 * before its rent field was ever filled). The current step is the earliest one
 * still unsatisfied.
 */
export function deriveRentalLifecycle(
  propertyId: string,
  input: RentalLifecycleInput,
): RentalLifecycle {
  const isLive = isPubliclyVisible(input.propertyStatus);
  const isLeased = input.propertyStatus === "leased";

  // An actual tenancy is the truth for the Lease/Tenanted steps — NOT lead.status.
  // Only a live (active) or forthcoming (upcoming) tenancy is forward progress;
  // an ended-only tenancy means the unit is between tenants.
  const tenancyActive = input.tenancyStatus === "active";
  const tenancyUpcoming = input.tenancyStatus === "upcoming";
  const hasCurrentTenancy = tenancyActive || tenancyUpcoming;

  const maxLeadRank = input.leadStatuses.reduce(
    (max, s) => Math.max(max, LEAD_RANK[s] ?? 0),
    0,
  );
  const totalLeads = input.leadStatuses.length;
  const viewingLeads = input.leadStatuses.filter(
    (s) => (LEAD_RANK[s] ?? 0) >= LEAD_RANK.booked,
  ).length;
  const appliedLeads = input.leadStatuses.filter(
    (s) => (LEAD_RANK[s] ?? 0) >= LEAD_RANK.applied,
  ).length;
  const leasedLeads = input.leadStatuses.filter((s) => s === "leased").length;

  // Raw, per-step satisfaction straight from the inputs (not yet monotone).
  const raw: Record<LifecycleStep, boolean> = {
    set_up: input.hasRent,
    market: isLive && input.photoCount >= 1,
    inquiries: totalLeads >= 1,
    viewings: maxLeadRank >= LEAD_RANK.booked,
    screen: maxLeadRank >= LEAD_RANK.applied,
    // A lease is "done" only when there is an actual tenancy record (or the unit
    // is explicitly marked leased) — never inferred from lead.status alone.
    lease: isLeased || hasCurrentTenancy,
    // A tenant is in place only when a tenancy is active (or the unit is marked
    // leased). An upcoming tenancy means the lease is signed but move-in is later.
    tenanted: isLeased || tenancyActive,
  };

  // Make it monotone from the back: satisfied[i] = raw[i] || satisfied[i+1].
  const satisfied: Record<string, boolean> = {};
  let later: boolean = false;
  for (let i = LIFECYCLE_STEPS.length - 1; i >= 0; i--) {
    const step = LIFECYCLE_STEPS[i];
    const val: boolean = raw[step] || later;
    satisfied[step] = val;
    later = val;
  }

  // The frontier: earliest unsatisfied step.
  const currentStep =
    LIFECYCLE_STEPS.find((step) => !satisfied[step]) ?? null;

  const detailFor = (step: LifecycleStep): string => {
    switch (step) {
      case "set_up":
        return input.hasRent ? "Details added" : "Add rent & details";
      case "market": {
        if (raw.market) {
          const bits = [propertyStatusLabel(input.propertyStatus)];
          bits.push(plural(input.photoCount, "photo", "photos"));
          if (input.listingPostCount > 0)
            bits.push(plural(input.listingPostCount, "post", "posts"));
          return bits.join(" · ");
        }
        if (input.photoCount === 0 && !isLive) return "Add photos & go live";
        if (!isLive) return "Go live to publish";
        return "Add photos to publish";
      }
      case "inquiries":
        return totalLeads >= 1
          ? plural(totalLeads, "inquiry", "inquiries")
          : "No inquiries yet";
      case "viewings":
        return viewingLeads >= 1
          ? `${viewingLeads} with a viewing`
          : input.hasAvailability
            ? "No viewings booked yet"
            : "Set viewing times to enable booking";
      case "screen":
        return appliedLeads >= 1
          ? plural(appliedLeads, "application", "applications")
          : "No applications yet";
      case "lease":
        // Only claim a lease when one actually exists (tenancy record or the
        // unit is marked leased). A lead marked "leased" with no tenancy yet is
        // a prompt to create the tenancy, not proof a lease was signed.
        if (isLeased || hasCurrentTenancy) return "Lease done";
        return leasedLeads >= 1 ? "Ready to start tenancy" : "No lease yet";
      case "tenanted":
        if (tenancyActive || isLeased) return "Tenant in place";
        if (tenancyUpcoming) return "Tenancy starts soon";
        return "Not tenanted yet";
    }
  };

  // Deep-links into the surface where each step's work actually happens.
  // Set up / Market / Inquiries live on this same rental page (anchors); the
  // later cross-unit stages route into their hub queues. Screen, once this unit
  // has applications, jumps to the inquiries list filtered to THIS rental's
  // applicants (?property=&status=applied) instead of the generic screening
  // config — so reviewing applications lands on the right rows.
  //
  // Lease / Tenanted (S282, IA G8 fix): if this unit has a tenancy, link
  // straight to it (the lease, rent setup, and tenant comms all live there);
  // otherwise route to the "new tenancy" form pre-filled for this property, so
  // the spine never dumps the operator at the cross-unit hub to re-find the unit.
  const hrefFor = (step: LifecycleStep): string => {
    const self = `/dashboard/properties/${propertyId}`;
    const tenancyHref = input.tenancyId
      ? `/dashboard/tenancies/${input.tenancyId}`
      : `/dashboard/tenancies/new?property=${propertyId}`;
    switch (step) {
      case "set_up":
        return `${self}#rental-details`;
      case "market":
        return `${self}#property-photos`;
      case "inquiries":
        return `${self}#inquiries`;
      case "viewings":
        return "/dashboard/showings";
      case "screen":
        return appliedLeads >= 1
          ? `/dashboard/leads?property=${propertyId}&status=applied`
          : "/dashboard/leasing/screening";
      case "lease":
        return tenancyHref;
      case "tenanted":
        return tenancyHref;
    }
  };

  const steps: LifecycleStepResult[] = LIFECYCLE_STEPS.map((step) => {
    const state: LifecycleStepState = satisfied[step]
      ? "done"
      : step === currentStep
        ? "current"
        : "todo";
    return {
      step,
      label: STEP_LABELS[step],
      state,
      detail: detailFor(step),
      href: hrefFor(step),
    };
  });

  return {
    steps,
    currentStep,
    completedCount: steps.filter((s) => s.state === "done").length,
    totalCount: LIFECYCLE_STEPS.length,
  };
}
