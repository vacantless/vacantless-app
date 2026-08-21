// ============================================================================
// Agent book overview — the cross-org "whole landlord book" roll-up (Tier 1 A).
//
// An agent (or any user who belongs to more than one landlord org) has, until
// now, been able to see only ONE org at a time: getCurrentOrg() does .limit(1)
// and the dashboard is org-bound. This module powers a read-only surface at
// /agent that shows EVERY active lease-up across ALL of the caller's orgs, one
// row per unit, with its lifecycle stage, its next action, and the few flags
// that decide "which unit needs me most right now".
//
// It introduces NO new query semantics: the org-scoped tables already gate rows
// on `organization_id in (select public.user_org_ids())`, so a read with no
// single-org filter returns rows across every org the caller belongs to. The
// page does the reads; this module is the PURE derivation over them, so it stays
// unit-testable (see scripts/test-agent-book.ts). It REUSES the per-unit engines
// (deriveRentalLifecycle, deriveNextAction) rather than re-deriving stage logic.
//
// Pure — no DOM / env / IO / Date.now.
// ============================================================================

import {
  deriveRentalLifecycle,
  lifecycleStepLabel,
  type LifecycleStep,
  type TenancyLifecycleStatus,
} from "./rental-lifecycle";
import { deriveNextAction, type NextActionPolicy } from "./rental-next-action";
import { isPublicBookable, type PropertyStatus } from "./listing-state";
import { type LeadStatus } from "./pipeline";

// Raw per-unit facts the page has already fetched (RLS cross-org). Everything
// derivable (hasRent, stage, next action, flags) is computed here so the page
// stays a thin reader.
export type AgentBookUnitInput = {
  orgId: string;
  propertyId: string;
  address: string;
  /** Optional short unit label; falls back to the address when absent. */
  unitLabel?: string | null;
  status: PropertyStatus;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  photoCount: number;
  /** listing_posts count, all statuses. Posting history, not current reach. */
  listingPostCount: number;
  /** listing_posts rows whose status is 'live'. Current outside reach. */
  liveListingPostCount: number;
  /** The unit's org has at least one weekly viewing window (per-org signal). */
  hasAvailability: boolean;
  leadStatuses: LeadStatus[];
  tenancyId?: string | null;
  tenancyStatus?: TenancyLifecycleStatus | null;
  /** Active tenancy exists but its current-rent ledger still needs landlord confirmation. */
  needsRentConfirm?: boolean;
  /** Distribution run items on this unit currently stuck at needs_operator. */
  needsOperatorCount: number;
};

// The "which unit needs me" signals, surfaced as inline chips on the row.
export type AgentBookFlags = {
  /** Inquiries with no operator touch yet (new / replied). */
  newLeadCount: number;
  /** Publish items waiting on the operator to finish a manual channel step. */
  needsOperatorCount: number;
  /** A live-track unit with zero photos. */
  photosMissing: boolean;
  /** Set up + has a photo, but sitting in Draft/Paused instead of Live. */
  notLiveButShould: boolean;
  /** Active tenancy must confirm current rent before rent-increase tracking starts. */
  rentUnconfirmed: boolean;
};

// Priority buckets, lowest = "needs you most first". Exposed so the table can
// group/filter on the same ranking the sort uses.
export const AGENT_BOOK_PRIORITY = {
  newLeads: 0,
  needsOperator: 1,
  setupOrMarket: 2,
  inFlight: 3,
  quiet: 4,
} as const;

export type AgentBookRow = {
  orgId: string;
  orgName: string;
  propertyId: string;
  tenancyId: string | null;
  /** Display label (unitLabel when present, else the address). */
  unitLabel: string;
  address: string;
  /** Lifecycle current-step label, or "Tenanted" when fully leased. */
  stage: string;
  /** The raw step key (or "tenanted") for filtering. */
  stageStep: LifecycleStep | "tenanted";
  /** deriveNextAction's primary CTA text ("" when fully tenanted). */
  nextAction: string;
  flags: AgentBookFlags;
  /** 0 (needs you most) .. 4 (quiet/leased). */
  priority: number;
};

export type AgentBookInput = {
  orgs: { id: string; name: string }[];
  units: AgentBookUnitInput[];
};

// All policy fields are optional on NextActionPolicy, so an empty object is a
// valid "no inherited defaults" input. We only read the CTA label off the
// result, which does not depend on the policy facts — so this stays correct
// without fetching every unit's resolved feature profile for the overview.
const EMPTY_POLICY: NextActionPolicy = {};

function hasPositiveRent(rentCents: number | null): boolean {
  return rentCents != null && rentCents > 0;
}

/**
 * Build the sorted agent-book rows. Pure: same input -> same output (no clock).
 * Rows are ordered "needs you most" first, then deterministically by org name
 * and address so the list is stable across renders.
 */
export function buildAgentBookRows(input: AgentBookInput): AgentBookRow[] {
  const orgNameById = new Map(input.orgs.map((o) => [o.id, o.name]));

  const rows: AgentBookRow[] = input.units.map((u) => {
    const hasRent = hasPositiveRent(u.rentCents);
    const bedsSet = u.beds != null;
    const bathsSet = u.baths != null;

    const lifecycle = deriveRentalLifecycle(u.propertyId, {
      propertyStatus: u.status,
      hasRent,
      bedsSet,
      bathsSet,
      photoCount: u.photoCount,
      listingPostCount: u.listingPostCount,
      liveListingPostCount: u.liveListingPostCount,
      hasAvailability: u.hasAvailability,
      leadStatuses: u.leadStatuses,
      tenancyId: u.tenancyId ?? null,
      tenancyStatus: u.tenancyStatus ?? null,
    });
    const currentStep = lifecycle.currentStep;

    const isLive = isPublicBookable(u.status);
    // Open = still in play (not lost, not already leased) — ready to move a step.
    const openInquiryCount = u.leadStatuses.filter(
      (s) => s !== "lost" && s !== "leased",
    ).length;
    const applicantCount = u.leadStatuses.filter((s) => s === "applied").length;

    const nextAction = deriveNextAction({
      propertyId: u.propertyId,
      currentStep,
      hasRent,
      bedsSet,
      bathsSet,
      effective: EMPTY_POLICY,
      inherited: new Set<string>(),
      isLive,
      photoCount: u.photoCount,
      channelCount: u.listingPostCount,
      linkIsLive: isLive,
      listingPostCount: u.listingPostCount,
      liveListingPostCount: u.liveListingPostCount,
      hasAvailability: u.hasAvailability,
      openInquiryCount,
      applicantCount,
    });

    const newLeadCount = u.leadStatuses.filter(
      (s) => s === "new" || s === "replied",
    ).length;
    const isClosed = u.status === "leased" || u.status === "off_market";
    const photosMissing = u.photoCount === 0 && !isClosed;
    const notLiveButShould =
      (u.status === "draft" || u.status === "paused") &&
      hasRent &&
      bedsSet &&
      bathsSet &&
      u.photoCount >= 1;
    const rentUnconfirmed = u.needsRentConfirm === true;

    const flags: AgentBookFlags = {
      newLeadCount,
      needsOperatorCount: u.needsOperatorCount,
      photosMissing,
      notLiveButShould,
      rentUnconfirmed,
    };

    const basePriority =
      newLeadCount > 0
        ? AGENT_BOOK_PRIORITY.newLeads
        : u.needsOperatorCount > 0
          ? AGENT_BOOK_PRIORITY.needsOperator
          : currentStep === "set_up" ||
              currentStep === "market" ||
              photosMissing ||
              notLiveButShould
            ? AGENT_BOOK_PRIORITY.setupOrMarket
            : currentStep != null
              ? AGENT_BOOK_PRIORITY.inFlight
              : AGENT_BOOK_PRIORITY.quiet;
    const priority =
      rentUnconfirmed && basePriority > AGENT_BOOK_PRIORITY.setupOrMarket
        ? AGENT_BOOK_PRIORITY.setupOrMarket
        : basePriority;

    const label = (u.unitLabel ?? "").trim();

    return {
      orgId: u.orgId,
      orgName: orgNameById.get(u.orgId) ?? "Unknown",
      propertyId: u.propertyId,
      tenancyId: u.tenancyId ?? null,
      unitLabel: label !== "" ? label : u.address,
      address: u.address,
      stage: currentStep ? lifecycleStepLabel(currentStep) : "Tenanted",
      stageStep: currentStep ?? "tenanted",
      nextAction: nextAction?.cta.label ?? "",
      flags,
      priority,
    };
  });

  return rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Heaviest signal first within the two action buckets.
    if (
      a.priority === AGENT_BOOK_PRIORITY.newLeads &&
      a.flags.newLeadCount !== b.flags.newLeadCount
    ) {
      return b.flags.newLeadCount - a.flags.newLeadCount;
    }
    if (
      a.priority === AGENT_BOOK_PRIORITY.needsOperator &&
      a.flags.needsOperatorCount !== b.flags.needsOperatorCount
    ) {
      return b.flags.needsOperatorCount - a.flags.needsOperatorCount;
    }
    const byOrg = a.orgName.localeCompare(b.orgName);
    if (byOrg !== 0) return byOrg;
    return a.address.localeCompare(b.address);
  });
}

// Group rows by org for the grouped table view, preserving the needs-you-most
// order within each org and ordering orgs by name.
export type AgentBookGroup = { orgId: string; orgName: string; rows: AgentBookRow[] };

export function groupAgentBookByOrg(rows: AgentBookRow[]): AgentBookGroup[] {
  const byOrg = new Map<string, AgentBookGroup>();
  for (const row of rows) {
    let group = byOrg.get(row.orgId);
    if (!group) {
      group = { orgId: row.orgId, orgName: row.orgName, rows: [] };
      byOrg.set(row.orgId, group);
    }
    group.rows.push(row);
  }
  return Array.from(byOrg.values()).sort((a, b) =>
    a.orgName.localeCompare(b.orgName),
  );
}
