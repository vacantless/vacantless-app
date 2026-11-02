import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeRole, roleCan, type Capability, type OrgRole } from "@/lib/roles";
import { readSelectedOrgCookie, validateSelectedOrg } from "@/lib/selected-org";

// Server-side membership/role resolution + capability guards for server actions.
//
// The signed-in user's role is read from their own memberships row (RLS policy
// membership_select lets a member read memberships in their own org). Unknown /
// missing roles are floored to the most restrictive role by normalizeRole, so a
// bad value can never over-grant. See lib/roles.ts for the capability matrix.

// The current user's role IN THE ACCOUNT THEY ARE LOOKING AT, or null when
// there is no authenticated user / no membership yet (pre-onboarding).
//
// S744: this used to read the caller's FIRST membership with no account filter.
// Once team invites exist, an owner of their own account who joins another as
// a teammate could get owner powers inside the other account. The active
// account is resolved exactly as getCurrentOrg() does (selected_org cookie,
// re-validated against the caller's memberships), and its role is returned.
export async function getCurrentRole(): Promise<OrgRole | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id);

  const rows = (data ?? []) as { organization_id: string | null; role: string | null }[];
  return roleForActiveOrg(rows, readSelectedOrgCookie());
}

// Pure: the role on the membership row of the active account. Exported for
// scripts/test-team-invites.ts.
export function roleForActiveOrg(
  rows: readonly { organization_id: string | null; role: string | null }[],
  cookieOrgId: string | null,
): OrgRole | null {
  const ids = rows
    .map((r) => r.organization_id)
    .filter((id): id is string => id != null);
  const active = validateSelectedOrg(cookieOrgId, ids);
  if (!active) return null;
  const raw = rows.find((r) => r.organization_id === active)?.role;
  if (raw == null) return null;
  return normalizeRole(raw);
}

// The caller's role in a SPECIFIC org, scoped by organization_id. Use when the
// target org is not necessarily the caller's default org — e.g. a multi-org user
// acting on a run whose organization_id came from the run itself. Returns null if
// they have no membership in that org (RLS lets a member read only their own
// membership rows). Prevents one org's role standing in for another's.
export async function getRoleForOrg(
  organizationId: string,
): Promise<OrgRole | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .limit(1);
  const raw = data?.[0]?.role as string | undefined;
  if (raw == null) return null;
  return normalizeRole(raw);
}

export async function currentUserCan(capability: Capability): Promise<boolean> {
  const role = await getCurrentRole();
  return role != null && roleCan(role, capability);
}

// Guard a privileged server action: if the caller lacks `capability`, redirect
// (which throws, short-circuiting the action) to a friendly forbidden state.
// A caller with no membership at all is sent to onboarding. Place this at the
// top of the action, alongside the existing getCurrentOrg() check.
export async function requireCapability(
  capability: Capability,
  forbiddenRedirect = "/dashboard?forbidden=1",
): Promise<void> {
  const role = await getCurrentRole();
  if (role == null) redirect("/onboarding");
  if (!roleCan(role, capability)) redirect(forbiddenRedirect);
}
