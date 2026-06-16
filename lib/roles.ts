// Pure role + capability model (no I/O) so it can be unit-tested in isolation.
//
// The seat model is the one Noam locked in S201 (project_vacantless_mvp_decisions
// #1). Two real permission tiers plus a forward-looking helper role:
//
//   * owner_admin     - the account owner. Everything, including billing.
//   * operator        - admin/operator. Manages properties, inquiry pages,
//                       viewing settings, reports, and org settings, but NOT
//                       billing (billing stays owner-only, per the audit's C1).
//   * showing_helper  - a showing-only helper. Can act on viewings assigned to
//                       them (mark attended/no-show/cancelled) and add basic
//                       notes, but CANNOT touch billing, account settings, all
//                       properties, or owner data (reports).
//
// Today every member is created as owner_admin (create_organization in 0001),
// and there is no invite flow yet, so the operator / showing_helper gates are
// forward-looking + defensive. The matrix is the single source of truth that the
// server guard (lib/membership.ts) reads; wiring it now means the helper feature
// can ship later without re-deciding the permission boundary.

export const ORG_ROLES = ["owner_admin", "operator", "showing_helper"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

// Every distinct privileged action surface. Grouped, not per-route, so the
// matrix stays small and a new route inherits an existing capability.
export const CAPABILITIES = [
  "manage_billing", // start/cancel subscription, pilot deposit, billing portal, plan changes
  "manage_settings", // branding, logo, reply-to, feature toggles (incl. SMS)
  "manage_properties", // create/edit/duplicate/delete units, listing posts, photos, price-drop blast
  "manage_availability", // booking windows, clustering settings
  "manage_leads", // change a lead's stage, set/clear follow-ups
  "add_notes", // add a timeline note to a lead
  "manage_showings", // mark a showing's outcome (attended/no-show/cancelled)
  "view_reports", // owner reporting dashboard
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ALL: Capability[] = [...CAPABILITIES];

// The capability matrix. owner_admin gets everything; operator gets everything
// except billing; showing_helper gets only its two job functions.
const MATRIX: Record<OrgRole, ReadonlySet<Capability>> = {
  owner_admin: new Set(ALL),
  operator: new Set(ALL.filter((c) => c !== "manage_billing")),
  showing_helper: new Set<Capability>(["add_notes", "manage_showings"]),
};

const ROLE_LABELS: Record<OrgRole, string> = {
  owner_admin: "Owner / admin",
  operator: "Operator",
  showing_helper: "Viewing helper",
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

// Coerce a stored/unknown role string to a known role. An unrecognized value is
// treated as the MOST restrictive role (showing_helper) so a bad/legacy value
// can never silently grant elevated access. A null/empty value also floors to
// the most restrictive role (callers that want "no membership" should branch
// before calling this).
export function normalizeRole(value: unknown): OrgRole {
  return isOrgRole(value) ? value : "showing_helper";
}

// Can this role perform this capability? Unknown roles are normalized down to
// the most restrictive role first, so this never throws and never over-grants.
export function roleCan(role: unknown, capability: Capability): boolean {
  return MATRIX[normalizeRole(role)].has(capability);
}

export function roleLabel(role: unknown): string {
  return ROLE_LABELS[normalizeRole(role)];
}

// The capabilities a role holds, as a stable, sorted list (handy for tests + a
// future "what can this seat do" UI).
export function capabilitiesFor(role: unknown): Capability[] {
  return ALL.filter((c) => MATRIX[normalizeRole(role)].has(c));
}
