/**
 * Pure logic for the account-provisioning primitive (S354) — no DB, env, or
 * Supabase access here, so it unit-tests cleanly via:
 *   npx tsx scripts/test-provisioning.ts
 *
 * The impure orchestration (service-role createUser + the provision RPC + seeds
 * + generateLink + the org_invites write) lives in lib/provisioning-server.ts.
 *
 * The primitive provisions a NEW org + owner_admin user and is exposed two ways:
 *   - operator-initiated (the scale version of the manual concierge onboarding)
 *   - landlord-initiated referral (a later slice; the same primitive)
 * A referral is just a landlord-triggered version of the operator onboarding —
 * one mechanism, two surfaces.
 */

export type InviteSource = "operator" | "referral";
export type InviteStatus =
  | "pending"
  | "provisioned"
  | "handed_off"
  | "accepted"
  | "revoked"
  | "failed";

export const INVITE_SOURCES: InviteSource[] = ["operator", "referral"];
export const INVITE_STATUSES: InviteStatus[] = [
  "pending",
  "provisioned",
  "handed_off",
  "accepted",
  "revoked",
  "failed",
];

// ---------------------------------------------------------------------------
// Email + name normalization
// ---------------------------------------------------------------------------

/** Lower-case + trim an email for storage + comparison (no citext dependency). */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Pragmatic email shape check — one @, a dot in the domain, no whitespace. Not
 * RFC-perfect (deliberately): the real proof an address works is the landlord
 * completing the set-password link, so this only catches obvious typos.
 */
export function isValidEmail(raw: string | null | undefined): boolean {
  const e = normalizeEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** Collapse a display name to a trimmed string (or null when empty). */
export function cleanName(raw: string | null | undefined): string | null {
  const n = (raw ?? "").trim().replace(/\s+/g, " ");
  return n.length ? n : null;
}

/**
 * Slugify an org name the same way onboarding does (lowercase, non-alnum -> '-',
 * trim hyphens, cap 40 chars, fall back to 'org'). The caller appends a short
 * random suffix for uniqueness — kept OUT of this pure fn so tests are stable.
 */
export function slugifyOrg(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export type ProvisionInput = {
  email: string;
  orgName: string;
  landlordName?: string | null;
  concierge?: boolean;
  intendedOwnerEmail?: string | null;
  source?: InviteSource;
  referredByOrgId?: string | null;
  referredByUserId?: string | null;
};

export type CleanProvisionInput = {
  email: string;
  orgName: string;
  landlordName: string | null;
  concierge: boolean;
  intendedOwnerEmail: string | null;
  source: InviteSource;
  referredByOrgId: string | null;
  referredByUserId: string | null;
};

export type ValidationResult =
  | { ok: true; value: CleanProvisionInput }
  | { ok: false; error: string };

/**
 * Validate + normalize a provisioning request. Pure: returns either a cleaned,
 * ready-to-use input or a human-readable error. The server layer calls this
 * first and refuses to touch the admin API on a bad input.
 */
export function validateProvisionInput(input: ProvisionInput): ValidationResult {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Email is required." };
  if (!isValidEmail(email))
    return { ok: false, error: "That doesn't look like a valid email." };

  const orgName = (input.orgName ?? "").trim().replace(/\s+/g, " ");
  if (!orgName) return { ok: false, error: "Account / organization name is required." };
  if (orgName.length > 120)
    return { ok: false, error: "Account name is too long (120 characters max)." };

  const source: InviteSource =
    input.source === "referral" ? "referral" : "operator";

  // A referral must carry its attribution; an operator invite must not.
  if (source === "referral" && !input.referredByOrgId) {
    return { ok: false, error: "A referral must be attributed to an organization." };
  }

  const concierge = input.concierge === true;
  const intendedOwnerEmail = concierge
    ? normalizeEmail(input.intendedOwnerEmail)
    : null;
  if (concierge && !isValidEmail(intendedOwnerEmail)) {
    return {
      ok: false,
      error: "Concierge setup needs the landlord's real email for handoff.",
    };
  }
  if (concierge && intendedOwnerEmail === email) {
    return {
      ok: false,
      error: "Use a proxy login email that is different from the landlord's real email.",
    };
  }

  return {
    ok: true,
    value: {
      email,
      orgName,
      landlordName: cleanName(input.landlordName),
      concierge,
      intendedOwnerEmail,
      source,
      referredByOrgId: source === "referral" ? input.referredByOrgId ?? null : null,
      referredByUserId: source === "referral" ? input.referredByUserId ?? null : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Superadmin allowlist (operator console gate)
// ---------------------------------------------------------------------------

/** Parse a comma/space/semicolon-separated allowlist into normalized emails. */
export function parseAdminEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is this signed-in email allowed to provision accounts? Pure (the allowlist is
 * passed in). The operator console gates on this AND a server-side recheck in
 * the action — the env-reading wrapper lives in lib/provisioning-server.ts.
 */
export function isAdminEmail(
  email: string | null | undefined,
  allowlist: string[],
): boolean {
  const e = normalizeEmail(email);
  return !!e && allowlist.includes(e);
}

// ---------------------------------------------------------------------------
// Provision outcome (shared by the server layer + the console UI)
// ---------------------------------------------------------------------------

export type ProvisionFailureReason =
  | "invalid_input"
  | "not_configured" // service-role key / admin client missing
  | "already_has_account" // an auth user with this email already exists
  | "already_provisioned" // an org_invites 'provisioned' row already exists for this email
  | "create_failed" // admin.createUser failed
  | "provision_failed" // the org/membership RPC failed
  | "unknown";

export type ProvisionOutcome =
  | {
      ok: true;
      orgId: string;
      userId: string;
      email: string;
      orgName: string;
      /** The set-password link to hand the landlord (may be null if link-gen failed). */
      inviteLink: string | null;
      concierge: boolean;
      intendedOwnerEmail: string | null;
    }
  | { ok: false; reason: ProvisionFailureReason; detail?: string };

export type HandoffFailureReason =
  | "invalid_input"
  | "not_configured"
  | "not_found"
  | "missing_intended_owner"
  | "email_mismatch"
  | "already_handed_off"
  | "already_has_account"
  | "update_failed"
  | "unknown";

export type HandoffInput = {
  inviteId: string;
  confirmEmail: string;
};

export type CleanHandoffInput = {
  inviteId: string;
  confirmEmail: string;
};

export type HandoffValidationResult =
  | { ok: true; value: CleanHandoffInput }
  | { ok: false; error: string };

export function validateHandoffInput(input: HandoffInput): HandoffValidationResult {
  const inviteId = (input.inviteId ?? "").trim();
  const confirmEmail = normalizeEmail(input.confirmEmail);
  if (!inviteId) return { ok: false, error: "Provisioning row is missing." };
  if (!isValidEmail(confirmEmail)) {
    return { ok: false, error: "Type the landlord email to confirm handoff." };
  }
  return { ok: true, value: { inviteId, confirmEmail } };
}

export type HandoffOutcome =
  | {
      ok: true;
      email: string;
      inviteLink: string | null;
    }
  | { ok: false; reason: HandoffFailureReason; detail?: string };

/** A friendly one-line explanation of a failure reason for the console. */
export function failureMessage(reason: ProvisionFailureReason): string {
  switch (reason) {
    case "invalid_input":
      return "Check the email and account name.";
    case "not_configured":
      return "Provisioning isn't configured on the server (missing service-role key).";
    case "already_has_account":
      return "An account with this email already exists — use the manual path or a different email.";
    case "already_provisioned":
      return "This email was already provisioned an account.";
    case "create_failed":
      return "Couldn't create the user account.";
    case "provision_failed":
      return "Couldn't create the organization.";
    default:
      return "Something went wrong.";
  }
}

export function handoffFailureMessage(reason: HandoffFailureReason): string {
  switch (reason) {
    case "invalid_input":
      return "Check the handoff email.";
    case "not_configured":
      return "Provisioning isn't configured on the server.";
    case "not_found":
      return "That provisioned account could not be found.";
    case "missing_intended_owner":
      return "This row has no intended landlord email saved.";
    case "email_mismatch":
      return "The confirmation email does not match the intended landlord email.";
    case "already_handed_off":
      return "This account was already handed off.";
    case "already_has_account":
      return "An account with the landlord email already exists.";
    case "update_failed":
      return "Couldn't move the login email to the landlord.";
    default:
      return "Something went wrong.";
  }
}

// ---------------------------------------------------------------------------
// Invite-row view shaping (operator console list)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<InviteStatus, string> = {
  pending: "Pending",
  provisioned: "Provisioned",
  handed_off: "Handed off",
  accepted: "Accepted",
  revoked: "Revoked",
  failed: "Failed",
};

export function inviteStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "") as InviteStatus;
  return STATUS_LABELS[s] ?? "—";
}

export function inviteSourceLabel(source: string | null | undefined): string {
  return source === "referral" ? "Referral" : "Operator";
}
