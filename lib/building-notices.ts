// Pure building-notice domain model (no I/O) so it can be unit-tested in
// isolation.
//
// A BUILDING NOTICE is the OUTBOUND, building-wide counterpart to the per-tenancy
// tenant message (0033 / lib/tenant-comms): an operator drafts one notice and it
// goes by EMAIL to every tenant on every tenancy in a chosen building. The
// demand case is scheduled building work (e.g. a whole-building power shutdown
// for electrical repairs) — operator -> tenant, usually NOT tied to any reported
// incident. It is GUARDRAIL-NEUTRAL: no trade actor, no money, no payment; the
// operator always drafts, reviews, and sends (never auto-send).
//
// The building grouping reuses the existing properties.building_key (0049, a
// STORED GENERATED normalized street identity) — every unit in a building already
// shares one key, so a notice targets a building_key and fans out to all its
// tenancies' tenants. No buildings table, no new grouping.
//
// This module owns: building-option assembly, notice validation, the
// "what to expect / impact" body composition, the recipient plan across
// tenancies (email-only for v1; SMS is a deferred follow-up), and a tally. The
// {{token}} substitution + token context are REUSED from lib/tenant-comms so a
// building notice renders {{first_name}}/{{property_address}}/{{org_name}} per
// recipient exactly like a per-tenancy message. See migration 0064.

import { splitAddressUnit } from "@/lib/listing-fill-sheet";
import type { TenantContact } from "@/lib/tenant-comms";

// --- Building options (the picker) ------------------------------------------

export type PropertyRef = {
  id: string;
  address: string;
  building_key: string | null;
};

export type BuildingOption = {
  buildingKey: string;
  label: string;
};

/**
 * Distinct buildings (by building_key) from a set of properties, each labeled by
 * its street address (unit/suite stripped). Properties with no building_key are
 * skipped (they can't be addressed as a building). Sorted by label for a stable
 * picker. Pure.
 */
export function buildBuildingOptions(properties: PropertyRef[]): BuildingOption[] {
  const labels = new Map<string, string>();
  for (const p of properties) {
    if (!p.building_key) continue;
    if (!labels.has(p.building_key)) {
      labels.set(p.building_key, splitAddressUnit(p.address).street ?? p.address);
    }
  }
  return [...labels.entries()]
    .map(([buildingKey, label]) => ({ buildingKey, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The display label for a building_key from an options list (fallback = key). */
export function buildingLabelFor(
  options: BuildingOption[],
  buildingKey: string,
): string {
  return options.find((o) => o.buildingKey === buildingKey)?.label ?? buildingKey;
}

// --- Body composition: the "what to expect" impact block --------------------

const IMPACT_HEADING = "What to expect:";

// House style: hyphens, never em/en dashes, in customer-facing copy.
function noEmDash(s: string): string {
  return s.replace(/[‒–—―]/g, "-");
}

/**
 * Compose the notice body the tenant receives: the operator's message, plus a
 * labeled "What to expect:" block when an impact line is provided. The impact
 * line is the one field an outbound scheduled-work notice needs that inbound
 * intake does not (e.g. "Power may be out 9 a.m. - 12 p.m."). Pure; idempotent
 * when impact is blank. Token substitution happens AFTER this (per recipient).
 */
export function composeNoticeBody(
  body: string,
  impact: string | null | undefined,
): string {
  const base = (body ?? "").trim();
  const imp = (impact ?? "").trim();
  const composed = imp ? `${base}\n\n${IMPACT_HEADING}\n${imp}` : base;
  return noEmDash(composed);
}

// --- Validation -------------------------------------------------------------

export type BuildingNoticeInput = {
  buildingKey: string;
  subject: string;
  body: string;
  recipientCount: number;
};
export type BuildingNoticeValidation =
  | { ok: true; value: { buildingKey: string; subject: string; body: string } }
  | { ok: false; code: string };

/**
 * Validate a building-notice send. Email-only for v1, so a subject is always
 * required (unlike the per-tenancy composer where sms-only drops it). Requires a
 * building, a subject, a body, and at least one resolvable recipient.
 */
export function validateBuildingNoticeInput(
  v: BuildingNoticeInput,
): BuildingNoticeValidation {
  const buildingKey = (v.buildingKey ?? "").trim();
  const subject = (v.subject ?? "").trim();
  const body = (v.body ?? "").trim();

  if (!buildingKey) return { ok: false, code: "building" };
  if (!subject) return { ok: false, code: "subject" };
  if (!body) return { ok: false, code: "body" };
  if (v.recipientCount <= 0) return { ok: false, code: "recipients" };

  return { ok: true, value: { buildingKey, subject, body } };
}

const ERROR_MESSAGES: Record<string, string> = {
  building: "Choose a building to notify.",
  subject: "Add a subject line.",
  body: "Write the notice.",
  recipients:
    "No tenants in this building have an email address on file. Add one before sending.",
  forbidden: "You don't have permission to send building notices.",
  notfound: "That building could not be found.",
  noone: "Nobody could be reached - no usable email addresses in this building.",
};

export function buildingNoticeErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

// --- Recipient plan across a building's tenancies ---------------------------

// A tenancy in the chosen building, with the data the token context needs.
export type BuildingTenancy = {
  tenancyId: string;
  propertyAddress: string | null;
  rentCents: number | null;
  tenants: TenantContact[];
};

// One planned email delivery for a building notice. Carries the tenancy +
// property so the action can render per-recipient tokens and log a delivery row
// without re-joining.
export type BuildingDelivery = {
  tenancyId: string;
  propertyAddress: string | null;
  rentCents: number | null;
  tenantId: string;
  tenantName: string | null;
  destination: string | null; // the email; null when none on file
  skipReason?: "no_email";
};

/**
 * Plan the EMAIL deliveries for a building notice: every tenant on every tenancy
 * in the building gets one planned delivery (a usable email, or a no_email skip).
 * A building notice is a broadcast, so there is no per-tenant selection — all
 * tenants are recipients. SMS is intentionally out of scope for v1 (a
 * building-wide text blast is a larger compliance surface; email matches the
 * demand case). Pure.
 */
export function planBuildingEmailDeliveries(
  tenancies: BuildingTenancy[],
): BuildingDelivery[] {
  const out: BuildingDelivery[] = [];
  for (const t of tenancies) {
    for (const tenant of t.tenants) {
      const email = (tenant.email ?? "").trim();
      out.push({
        tenancyId: t.tenancyId,
        propertyAddress: t.propertyAddress,
        rentCents: t.rentCents,
        tenantId: tenant.id,
        tenantName: tenant.name,
        destination: email || null,
        ...(email ? {} : { skipReason: "no_email" as const }),
      });
    }
  }
  return out;
}

/** True if a planned building delivery can actually be attempted. */
export function isBuildingSendable(d: BuildingDelivery): boolean {
  return !d.skipReason && !!d.destination;
}

export type BuildingDeliveryTally = {
  tenancyCount: number; // distinct tenancies with at least one recipient
  recipientCount: number; // distinct tenants with at least one planned delivery
  sendable: number; // deliveries we will actually attempt
  skipped: number; // deliveries skipped (no email)
};

/** Summarize a building plan: distinct tenancies, distinct tenants, send/skip. */
export function tallyBuildingDeliveries(
  plan: BuildingDelivery[],
): BuildingDeliveryTally {
  const tenancies = new Set<string>();
  const tenants = new Set<string>();
  let sendable = 0;
  let skipped = 0;
  for (const d of plan) {
    tenancies.add(d.tenancyId);
    tenants.add(d.tenantId);
    if (isBuildingSendable(d)) sendable++;
    else skipped++;
  }
  return {
    tenancyCount: tenancies.size,
    recipientCount: tenants.size,
    sendable,
    skipped,
  };
}

// --- Starter template -------------------------------------------------------
//
// A single seed for the demand case (Xavier's scheduled-electrical-work notice).
// Bodies use ONLY the real tenant-comms MESSAGE_TOKENS and leave [bracket gaps]
// the operator fills before sending. The "what to expect" line is entered in the
// separate impact field, not the body. House style: hyphens, never em/en dashes.

export type BuildingNoticeTemplate = {
  name: string;
  subject: string;
  body: string;
  impact: string;
};

export const SCHEDULED_WORK_TEMPLATE: BuildingNoticeTemplate = {
  name: "Scheduled building work",
  subject: "Scheduled work at {{property_address}} - [date]",
  body:
    "Hi {{first_name}},\n\n" +
    "We're letting all residents know about scheduled work in the building:\n\n" +
    "- What: [brief description of the work, e.g. main electrical panel repairs]\n" +
    "- When: [date], [start time] - [end time]\n" +
    "- Who's doing it: [contractor / our team]\n\n" +
    "There's nothing you need to do. If you have any questions, just reply to this message.\n\n" +
    "Thank you for your patience,\n{{org_name}}",
  impact:
    "[Describe any disruption, e.g. power may be unavailable during the work window. " +
    "Please save anything important beforehand.]",
};
