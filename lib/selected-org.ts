// ============================================================================
// Selected-org cookie helper (Tier 1 B — org switcher).
//
// A user can belong to more than one landlord org (memberships are per-org).
// getCurrentOrg() used to pick an arbitrary one via .limit(1); this helper adds
// a session-level SELECTION so a multi-org agent can choose which client org is
// active. The selection lives in a `selected_org` cookie, always re-validated
// against the caller's actual memberships (RLS lets a member read only their own
// membership rows), so a stale or forged cookie can never activate an org the
// caller does not belong to.
//
// validateSelectedOrg is PURE (unit-tested in scripts/test-selected-org.ts). The
// cookie read/write wrappers use next/headers; writes MUST happen in a server
// action or route handler (Next forbids cookie mutation during render).
// ============================================================================

import { cookies } from "next/headers";

export const SELECTED_ORG_COOKIE = "selected_org";

/**
 * Resolve the effective org id from a cookie value and the caller's membership
 * set. Pure and total:
 *   - cookie is a member org        -> that org
 *   - cookie missing / not a member -> the first membership org
 *   - no memberships at all         -> null
 * Never returns an org the caller is not a member of.
 */
export function validateSelectedOrg(
  cookieOrgId: string | null | undefined,
  membershipOrgIds: readonly string[],
): string | null {
  if (membershipOrgIds.length === 0) return null;
  if (cookieOrgId && membershipOrgIds.includes(cookieOrgId)) return cookieOrgId;
  return membershipOrgIds[0];
}

/** Read the raw selected-org cookie value (SSR-safe, read-only). */
export function readSelectedOrgCookie(): string | null {
  return cookies().get(SELECTED_ORG_COOKIE)?.value ?? null;
}

/**
 * Persist the selected org. Call only from a server action / route handler —
 * Next allows cookie mutation only there, never during a render pass.
 */
export function writeSelectedOrgCookie(orgId: string): void {
  cookies().set(SELECTED_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
