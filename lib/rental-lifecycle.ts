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
    lease: isLeased || maxLeadRank >= LEAD_RANK.leased,
    tenanted: isLeased,
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
        if (isLeased) return "Lease done";
        return leasedLeads >= 1 ? "Lease signed" : "No lease yet";
      case "tenanted":
        return isLeased ? "Tenant in place" : "Not tenanted yet";
    }
  };

  // Deep-links into the surface where each step's work actually happens.
  // Set up / Market / Inquiries live on this same rental page (anchors); the
  // later cross-unit stages route into their hub queues.
  const hrefFor = (step: LifecycleStep): string => {
    const self = `/dashboard/properties/${propertyId}`;
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
        return "/dashboard/leasing/screening";
      case "lease":
        return "/dashboard/tenants";
      case "tenanted":
        return "/dashboard/tenants";
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
