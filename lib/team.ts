// S744 (roadmap item 14): team invites. Pure rules, no I/O, so they can be
// unit-tested (scripts/test-team-invites.ts). The server half is
// lib/team-server.ts.
//
// Seats follow the S201 decision (project_vacantless_mvp_decisions #1): the
// owner plus a small number of teammates, more on bigger plans. Free stays a
// one-person account; invites are part of Growth.

import { createHash, randomBytes } from "node:crypto";
import type { OrgRole } from "@/lib/roles";

export const INVITE_TTL_DAYS = 14;

/**
 * Roles an owner can invite today. Slice 1 offers the Teammate (operator) role
 * only. The viewing-helper role needs the dashboard pages to hide what a helper
 * must not see (all rentals, money, reports); until that ships, inviting one
 * would hand them a full view. Add "showing_helper" here once it does.
 */
export const INVITABLE_ROLES: readonly OrgRole[] = ["operator"] as const;

/** Teammates allowed beyond the first person on the account, per plan. */
const TEAMMATE_LIMITS: Record<string, number> = {
  free: 0,
  trial: 0,
  growth: 2,
  core: 2,
  premium: 5,
  managed: 5,
  plus: 5,
  pilot: 5,
};

export function teammateLimit(plan: string | null | undefined): number {
  if (!plan) return 0;
  return Object.prototype.hasOwnProperty.call(TEAMMATE_LIMITS, plan)
    ? TEAMMATE_LIMITS[plan]
    : 0;
}

/**
 * Seats still open. Every member after the first counts, and so does every
 * open invite, so an owner can't send more invites than there are seats.
 */
export function seatsLeft(p: {
  plan: string | null | undefined;
  memberCount: number;
  pendingInviteCount: number;
}): number {
  const used = Math.max(0, p.memberCount - 1) + Math.max(0, p.pendingInviteCount);
  return Math.max(0, teammateLimit(p.plan) - used);
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmailShaped(raw: string | null | undefined): boolean {
  return EMAIL_RE.test(normalizeEmail(raw));
}

/** A fresh 192-bit url-safe token for the emailed link. */
export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/** What the database stores in place of the token. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type InviteRow = {
  status: string;
  expires_at: string;
  invited_email: string;
  organization_id: string;
};

export type AcceptCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        | "used"
        | "revoked"
        | "expired"
        | "wrong_email"
        | "email_not_confirmed"
        | "already_member";
    };

/**
 * Can this signed-in person accept this invite? The email match is the real
 * check; the token only finds the row. An unconfirmed email never counts, or
 * anyone could sign up with someone else's address and take their seat.
 */
export function checkAccept(p: {
  invite: InviteRow | null;
  userEmail: string | null | undefined;
  emailConfirmed: boolean;
  memberOrgIds: readonly string[];
  now: Date;
}): AcceptCheck {
  const inv = p.invite;
  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.status === "accepted") return { ok: false, reason: "used" };
  if (inv.status === "revoked") return { ok: false, reason: "revoked" };
  if (inv.status !== "pending") return { ok: false, reason: "not_found" };
  if (new Date(inv.expires_at).getTime() <= p.now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (normalizeEmail(p.userEmail) !== normalizeEmail(inv.invited_email)) {
    return { ok: false, reason: "wrong_email" };
  }
  if (!p.emailConfirmed) return { ok: false, reason: "email_not_confirmed" };
  if (p.memberOrgIds.includes(inv.organization_id)) {
    return { ok: false, reason: "already_member" };
  }
  return { ok: true };
}

/** One short line for each refusal, shown on the join page. */
export const ACCEPT_MESSAGES: Record<Exclude<AcceptCheck, { ok: true }>["reason"], string> = {
  not_found: "This invite link doesn't work. Ask for a new one.",
  used: "This invite was already used. Log in to see the account.",
  revoked: "This invite was cancelled. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
  wrong_email: "This invite is for a different email. Log in with that email.",
  email_not_confirmed: "Confirm your email first. Then open this link again.",
  already_member: "You're already on this team.",
};

/** Teammate-facing name for a role. */
export function teamRoleLabel(role: string | null | undefined): string {
  if (role === "owner_admin") return "Owner";
  if (role === "operator") return "Teammate";
  if (role === "showing_helper") return "Viewing helper";
  return "Teammate";
}

/** What each invitable role can do, in one line. */
export function teamRoleBlurb(role: string | null | undefined): string {
  if (role === "operator") return "Can do everything except billing and the team.";
  if (role === "showing_helper") return "Can see their viewings and add notes.";
  return "";
}

export function inviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
