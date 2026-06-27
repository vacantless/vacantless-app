/**
 * Pure logic for the referral loop (S355, Slice 2) — no DB, env, or Supabase
 * access here, so it unit-tests cleanly via:
 *   npx tsx scripts/test-referrals.ts
 *
 * The impure orchestration (the service-role accept-flip) lives in
 * lib/referrals-server.ts; the authed insert lives in the page's actions.ts.
 *
 * The model (decided S354, Noam): a referral behaves like a cold homepage
 * signup — immediate, self-serve, NO approval. A landlord generates a referral
 * link that drops the friend into the normal /signup flow (the friend creates
 * their OWN account); we only record who referred them. An org_invites row
 * source='referral' starts 'pending' (invited, not yet signed up) and flips to
 * 'accepted' when the friend completes signup. No primitive call, no migration.
 */

import {
  normalizeEmail,
  isValidEmail,
  cleanName,
  type InviteStatus,
} from "@/lib/provisioning";

// ---------------------------------------------------------------------------
// Referral token (the ?ref= handle that threads signup -> onboarding)
// ---------------------------------------------------------------------------

/**
 * Sanitize a referral token arriving from the URL (`/signup?ref=<token>`).
 * Tokens are base64url (the randomBytes(24).toString('base64url') pattern): the
 * 64-char alphabet A-Z a-z 0-9 - _, length-bounded. Anything else is junk (or an
 * injection probe) and resolves to null so the caller treats it as "no referral".
 */
export function parseRefToken(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (t.length < 16 || t.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

// ---------------------------------------------------------------------------
// "Refer a landlord" form input (the landlord's OWN optional label for a friend)
// ---------------------------------------------------------------------------

export type ReferralFriendInput = {
  email?: string | null;
  name?: string | null;
};

export type CleanReferralFriend = {
  email: string | null;
  name: string | null;
};

export type ReferralFriendResult =
  | { ok: true; value: CleanReferralFriend }
  | { ok: false; error: string };

/**
 * Validate the OPTIONAL friend email/name a landlord may attach to a referral
 * for their own tracking. Both are optional (a referral link can be generated
 * with no details at all); if an email is supplied it must look valid. This is
 * the landlord's note about WHO they're referring — never tenant PII.
 */
export function validateReferralFriend(
  input: ReferralFriendInput,
): ReferralFriendResult {
  const email = normalizeEmail(input.email);
  if (email && !isValidEmail(email)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }
  const name = cleanName(input.name);
  if (name && name.length > 120) {
    return { ok: false, error: "Name is too long (120 characters max)." };
  }
  return { ok: true, value: { email: email || null, name } };
}

// ---------------------------------------------------------------------------
// Building the shareable link
// ---------------------------------------------------------------------------

/**
 * The referral link a landlord sends a friend. Drops them into the normal
 * self-serve signup with the attribution token attached. `origin` has any
 * trailing slash trimmed; the token is URL-encoded defensively (it's already
 * url-safe base64url, so this is belt-and-suspenders).
 */
export function buildReferralLink(origin: string, token: string): string {
  const base = (origin ?? "").replace(/\/+$/, "");
  return `${base}/signup?ref=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Accept-flip decision (pure; the server layer does the actual UPDATE)
// ---------------------------------------------------------------------------

/** The shape the accept logic needs from a fetched org_invites row. */
export type AcceptCandidateRow = {
  status: string;
  source: string;
  referred_by_org_id: string | null;
} | null;

export type AcceptDecision =
  | { accept: true }
  | { accept: false; reason: "no_token" | "not_found" | "not_pending" | "not_referral" | "self_referral" };

/**
 * Decide whether a freshly-signed-up org should be attributed to a referral row.
 * Pure: the server layer fetches the row by token and applies this, then (only
 * when accept) performs the service-role UPDATE. Every "false" path is a SILENT
 * skip — attribution is best-effort and must never block the friend's signup.
 */
export function canAcceptReferral(
  row: AcceptCandidateRow,
  newOrgId: string | null | undefined,
): AcceptDecision {
  if (!newOrgId) return { accept: false, reason: "no_token" };
  if (!row) return { accept: false, reason: "not_found" };
  if (row.source !== "referral") return { accept: false, reason: "not_referral" };
  if (row.status !== "pending") return { accept: false, reason: "not_pending" };
  // Defensive: a brand-new org can't equal the referrer's, but never let a row
  // attribute an org to itself.
  if (row.referred_by_org_id && row.referred_by_org_id === newOrgId) {
    return { accept: false, reason: "self_referral" };
  }
  return { accept: true };
}

// ---------------------------------------------------------------------------
// "Your referrals" list view shaping
// ---------------------------------------------------------------------------

export type ReferralRow = {
  id: string;
  created_at: string;
  invited_email: string | null;
  invited_name: string | null;
  status: string;
  token: string;
  accepted_at: string | null;
};

export type ReferralView = {
  id: string;
  /** Best human label: name, else email, else a generic placeholder. */
  label: string;
  statusLabel: string;
  isPending: boolean;
  isAccepted: boolean;
  createdAt: string;
  acceptedAt: string | null;
  token: string;
};

const REFERRAL_STATUS_LABELS: Partial<Record<InviteStatus, string>> = {
  pending: "Invited",
  accepted: "Joined",
  revoked: "Revoked",
  failed: "Failed",
};

/** Friendly status text for a referral row (landlord-facing wording). */
export function referralStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "") as InviteStatus;
  return REFERRAL_STATUS_LABELS[s] ?? "—";
}

/** Map one DB row to its list view-model. */
export function shapeReferralRow(row: ReferralRow): ReferralView {
  const label =
    cleanName(row.invited_name) ||
    normalizeEmail(row.invited_email) ||
    "Invited landlord";
  return {
    id: row.id,
    label,
    statusLabel: referralStatusLabel(row.status),
    isPending: row.status === "pending",
    isAccepted: row.status === "accepted",
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    token: row.token,
  };
}

/** Map + sort referral rows for the "Your referrals" list (newest first). */
export function shapeReferralRows(rows: ReferralRow[]): ReferralView[] {
  return [...rows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .map(shapeReferralRow);
}

/** Quick count summary for the list header. */
export function referralCounts(rows: ReferralRow[]): {
  total: number;
  joined: number;
  pending: number;
} {
  let joined = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "accepted") joined++;
    else if (r.status === "pending") pending++;
  }
  return { total: rows.length, joined, pending };
}
