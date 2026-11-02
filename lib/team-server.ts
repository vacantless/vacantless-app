// S744 (roadmap item 14): the server half of team invites. Every function here
// uses the service-role client, so callers MUST check the caller's role first
// (app/dashboard/settings/team-actions.ts and app/join/[token]/actions.ts do).
// team_invites has RLS on with no policies; nothing else can read it.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkAccept,
  hashInviteToken,
  INVITABLE_ROLES,
  inviteExpiresAt,
  isEmailShaped,
  newInviteToken,
  normalizeEmail,
  seatsLeft,
  type AcceptCheck,
} from "@/lib/team";
import type { OrgRole } from "@/lib/roles";

export type TeamMember = {
  membershipId: string;
  userId: string;
  email: string | null;
  role: string;
  joinedAt: string;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
};

export type TeamView = {
  members: TeamMember[];
  invites: TeamInvite[];
};

export async function loadTeam(orgId: string): Promise<TeamView | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const [{ data: mRows }, { data: iRows }] = await Promise.all([
    admin
      .from("memberships")
      .select("id, user_id, role, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true }),
    admin
      .from("team_invites")
      .select("id, invited_email, role, created_at, expires_at")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true }),
  ]);
  const members: TeamMember[] = await Promise.all(
    (mRows ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id as string);
      return {
        membershipId: m.id as string,
        userId: m.user_id as string,
        email: data?.user?.email ?? null,
        role: m.role as string,
        joinedAt: m.created_at as string,
      };
    }),
  );
  const invites: TeamInvite[] = (iRows ?? []).map((i) => ({
    id: i.id as string,
    email: i.invited_email as string,
    role: i.role as string,
    createdAt: i.created_at as string,
    expiresAt: i.expires_at as string,
  }));
  return { members, invites };
}

export type CreateInviteResult =
  | { ok: true; token: string; email: string }
  | {
      ok: false;
      reason: "not_configured" | "bad_email" | "bad_role" | "no_seats" | "already_member" | "error";
    };

/**
 * Create (or replace) the open invite for this email. A second invite to the
 * same email cancels the first, so only the newest link works.
 */
export async function createTeamInvite(p: {
  orgId: string;
  plan: string | null | undefined;
  email: string;
  role: string;
  invitedBy: string;
}): Promise<CreateInviteResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "not_configured" };
  const email = normalizeEmail(p.email);
  if (!isEmailShaped(email)) return { ok: false, reason: "bad_email" };
  if (!(INVITABLE_ROLES as readonly string[]).includes(p.role)) {
    return { ok: false, reason: "bad_role" };
  }

  const team = await loadTeam(p.orgId);
  if (!team) return { ok: false, reason: "not_configured" };
  if (team.members.some((m) => normalizeEmail(m.email) === email)) {
    return { ok: false, reason: "already_member" };
  }
  const replacing = team.invites.some((i) => normalizeEmail(i.email) === email);
  const left = seatsLeft({
    plan: p.plan,
    memberCount: team.members.length,
    pendingInviteCount: team.invites.length - (replacing ? 1 : 0),
  });
  if (left <= 0) return { ok: false, reason: "no_seats" };

  const nowIso = new Date().toISOString();
  // Cancel any open invite for this email (including expired ones, so the
  // one-pending unique index never blocks the new row).
  await admin
    .from("team_invites")
    .update({ status: "revoked", revoked_at: nowIso })
    .eq("organization_id", p.orgId)
    .eq("status", "pending")
    .ilike("invited_email", email);

  const token = newInviteToken();
  const { error } = await admin.from("team_invites").insert({
    organization_id: p.orgId,
    invited_email: email,
    role: p.role,
    token_hash: hashInviteToken(token),
    invited_by: p.invitedBy,
    expires_at: inviteExpiresAt(new Date()).toISOString(),
  });
  if (error) return { ok: false, reason: "error" };
  return { ok: true, token, email };
}

export async function revokeTeamInvite(orgId: string, inviteId: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { data, error } = await admin
    .from("team_invites")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", inviteId)
    .eq("status", "pending")
    .select("id");
  return !error && (data ?? []).length === 1;
}

export type RemoveResult = { ok: true } | { ok: false; reason: "self" | "owner" | "not_found" | "error" };

/** Remove a teammate. Owners can't be removed here, and nobody removes themselves. */
export async function removeTeamMember(p: {
  orgId: string;
  membershipId: string;
  callerUserId: string;
}): Promise<RemoveResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "error" };
  const { data } = await admin
    .from("memberships")
    .select("id, user_id, role")
    .eq("organization_id", p.orgId)
    .eq("id", p.membershipId)
    .limit(1);
  const row = data?.[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.user_id === p.callerUserId) return { ok: false, reason: "self" };
  if (row.role === "owner_admin") return { ok: false, reason: "owner" };
  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("organization_id", p.orgId)
    .eq("id", p.membershipId);
  return error ? { ok: false, reason: "error" } : { ok: true };
}

export type InviteForJoin = {
  id: string;
  organization_id: string;
  org_name: string;
  invited_email: string;
  role: string;
  status: string;
  expires_at: string;
};

async function inviteWhere(
  column: "token_hash" | "id",
  value: string,
): Promise<InviteForJoin | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("team_invites")
    .select("id, organization_id, invited_email, role, status, expires_at, organizations(name)")
    .eq(column, value)
    .limit(1);
  const r = data?.[0] as
    | (Omit<InviteForJoin, "org_name"> & { organizations: { name: string } | { name: string }[] | null })
    | undefined;
  if (!r) return null;
  const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
  return {
    id: r.id,
    organization_id: r.organization_id,
    org_name: org?.name ?? "this account",
    invited_email: r.invited_email,
    role: r.role,
    status: r.status,
    expires_at: r.expires_at,
  };
}

export function inviteByToken(token: string): Promise<InviteForJoin | null> {
  if (!token || token.length < 16 || token.length > 128) return Promise.resolve(null);
  return inviteWhere("token_hash", hashInviteToken(token));
}

export function inviteById(id: string): Promise<InviteForJoin | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
  return inviteWhere("id", id);
}

/** Open, unexpired invites for this email (newest first). Used by onboarding. */
export async function openInvitesForEmail(email: string | null | undefined): Promise<InviteForJoin[]> {
  const admin = createAdminClient();
  const e = normalizeEmail(email);
  if (!admin || !e) return [];
  const { data } = await admin
    .from("team_invites")
    .select("id")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .ilike("invited_email", e)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = await Promise.all((data ?? []).map((r) => inviteById(r.id as string)));
  return rows.filter((r): r is InviteForJoin => r != null);
}

export type AcceptResult = { ok: true; orgId: string } | Exclude<AcceptCheck, { ok: true }> | { ok: false; reason: "error" };

/** Accept an invite for this signed-in user: add the membership, close the invite. */
export async function acceptTeamInvite(p: {
  invite: InviteForJoin | null;
  userId: string;
  userEmail: string | null | undefined;
  emailConfirmed: boolean;
}): Promise<AcceptResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "error" };
  const { data: mine } = await admin
    .from("memberships")
    .select("organization_id")
    .eq("user_id", p.userId);
  const check = checkAccept({
    invite: p.invite,
    userEmail: p.userEmail,
    emailConfirmed: p.emailConfirmed,
    memberOrgIds: (mine ?? []).map((m) => m.organization_id as string),
    now: new Date(),
  });
  if (!check.ok) return check;
  const inv = p.invite!;

  // Close the invite first (only if still pending), so a double click can't
  // add two rows or reuse a link.
  const { data: closed } = await admin
    .from("team_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_user_id: p.userId })
    .eq("id", inv.id)
    .eq("status", "pending")
    .select("id");
  if ((closed ?? []).length !== 1) return { ok: false, reason: "used" };

  const { error } = await admin.from("memberships").insert({
    organization_id: inv.organization_id,
    user_id: p.userId,
    role: inv.role as OrgRole,
  });
  if (error) {
    // Put the invite back so the person can try again.
    await admin
      .from("team_invites")
      .update({ status: "pending", accepted_at: null, accepted_user_id: null })
      .eq("id", inv.id);
    return { ok: false, reason: "error" };
  }
  return { ok: true, orgId: inv.organization_id };
}
