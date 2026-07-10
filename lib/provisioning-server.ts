// Impure orchestration for the account-provisioning primitive (S354).
//
// SERVER-ONLY. Uses the service-role admin client (bypasses RLS), so this must
// never be imported into a client component. It stands up a brand-new landlord:
//   1. validate + normalize the request (pure, lib/provisioning)
//   2. idempotency: refuse if this email already has a 'provisioned' invite
//   3. create the auth user with NO password (admin API) — we never set or know
//      their password; they prove control by completing the set-password link.
//      An "already registered" error => already_has_account (never a 2nd org).
//   4. provision the org + owner_admin membership atomically for THAT user via
//      the service_role-only RPC provision_organization_for_user (0077)
//   5. default the org to the free funnel tier + seed clauses/templates
//   6. generate a recovery (set-password) link to hand the landlord
//   7. record the org_invites row (audit + idempotency + referral attribution)
//
// This is the legitimate replacement for the v0 "sign up as them" hack: nobody
// authenticates as the landlord, and account creation stays operator-triggered
// (the console gates on the superadmin allowlist + a server-side recheck).

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedClauseLibrary, seedTenantMessageTemplates } from "@/lib/org-seeds-server";
import {
  validateProvisionInput,
  validateHandoffInput,
  slugifyOrg,
  parseAdminEmails,
  type ProvisionInput,
  type ProvisionOutcome,
  type HandoffInput,
  type HandoffOutcome,
} from "@/lib/provisioning";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

/** The superadmin allowlist, read from the env (PROVISIONING_ADMIN_EMAILS). */
export function adminEmails(): string[] {
  return parseAdminEmails(process.env.PROVISIONING_ADMIN_EMAILS);
}

/** A 192-bit url-safe handle for the org_invites row (the share/signing pattern). */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Provision a new landlord org + owner_admin user and return a set-password link
 * for them. Best-effort seeds never block. See the module header for the flow.
 */
export async function provisionLandlordOrg(
  input: ProvisionInput,
): Promise<ProvisionOutcome> {
  const v = validateProvisionInput(input);
  if (!v.ok) return { ok: false, reason: "invalid_input", detail: v.error };
  const {
    email,
    orgName,
    landlordName,
    concierge,
    intendedOwnerEmail,
    source,
    referredByOrgId,
    referredByUserId,
  } = v.value;

  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "not_configured" };

  // 2. Idempotency: a prior live concierge invite for this email wins.
  {
    const { data: existing } = await admin
      .from("org_invites")
      .select("id")
      .in("status", ["provisioned", "handed_off"])
      .ilike("invited_email", email)
      .limit(1);
    if (existing && existing.length > 0) {
      return { ok: false, reason: "already_provisioned" };
    }
  }

  // 3. Create the auth user with no password (email pre-confirmed: we vouch for
    // the address; the landlord proves control via the set-password link).
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (cErr || !created?.user) {
    const msg = cErr?.message ?? "";
    if (/already|registered|exists|duplicate/i.test(msg)) {
      return { ok: false, reason: "already_has_account" };
    }
    return { ok: false, reason: "create_failed", detail: msg };
  }
  const userId = created.user.id;

  // 4. Provision org + owner_admin membership atomically for this user.
  const slug = `${slugifyOrg(orgName)}-${randomBytes(2).toString("hex")}`;
  const { data: org, error: oErr } = await admin
    .rpc("provision_organization_for_user", {
      p_user_id: userId,
      p_name: orgName,
      p_slug: slug,
    })
    .single();

  if (oErr || !org) {
    // Roll back the just-created user so a failed provision never leaves an
    // orphan auth user that would later read as already_has_account.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, reason: "provision_failed", detail: oErr?.message };
  }
  const orgId = (org as { id: string }).id;

  // 5. Default to the free funnel tier + seed starter content (best-effort).
  // Concierge orgs stay safely pointed at the proxy/operator login until the
  // explicit owner-handoff action moves the auth email and public contacts.
  await admin
    .from("organizations")
    .update({
      plan: "free",
      ...(concierge
        ? {
            concierge: true,
            reply_to_email: email,
            public_contact_email: email,
            public_contact_phone: null,
          }
        : {}),
    })
    .eq("id", orgId);
  await seedClauseLibrary(admin, orgId);
  await seedTenantMessageTemplates(admin, orgId);

  // 6. Generate the set-password link (reuses the proven recovery ->
  //    /auth/callback?next=/reset-password flow, S348). May fail independently;
  //    the account still exists, so we surface a null link rather than failing.
  let inviteLink: string | null = null;
  try {
    const { data: link } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${APP_URL}/auth/callback?next=/reset-password` },
    });
    inviteLink =
      (link as { properties?: { action_link?: string } } | null)?.properties
        ?.action_link ?? null;
  } catch {
    inviteLink = null;
  }

  // 7. Record the invite (audit + idempotency + referral attribution).
  const nowIso = new Date().toISOString();
  await admin.from("org_invites").insert({
    invited_email: email,
    invited_name: landlordName,
    intended_owner_email: intendedOwnerEmail,
    status: "provisioned",
    source,
    referred_by_org_id: referredByOrgId,
    referred_by_user_id: referredByUserId,
    provisioned_org_id: orgId,
    provisioned_user_id: userId,
    token: newToken(),
    provisioned_at: nowIso,
  });

  return {
    ok: true,
    orgId,
    userId,
    email,
    orgName,
    inviteLink,
    concierge,
    intendedOwnerEmail,
  };
}

/** Recent invites for the operator console (service-role read; newest first). */
export type InviteRow = {
  id: string;
  created_at: string;
  invited_email: string | null;
  invited_name: string | null;
  status: string;
  source: string;
  provisioned_org_id: string | null;
  provisioned_user_id: string | null;
  intended_owner_email: string | null;
  handed_off_at: string | null;
  handed_off_to_email: string | null;
  referred_by_org_id: string | null;
  provisioned_at: string | null;
};

export async function listRecentInvites(limit = 30): Promise<InviteRow[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data } = await admin
    .from("org_invites")
    .select(
      "id, created_at, invited_email, invited_name, status, source, provisioned_org_id, provisioned_user_id, intended_owner_email, handed_off_at, handed_off_to_email, referred_by_org_id, provisioned_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as InviteRow[] | null) ?? [];
}

/**
 * Move a concierge/proxy provisioned account to the intended landlord email.
 * This preserves the one-org-per-user model: same auth user, same membership,
 * same prepared org. The landlord receives a fresh recovery link to set their
 * own password after the login email is moved.
 */
export async function handoffProvisionedOrg(
  input: HandoffInput,
): Promise<HandoffOutcome> {
  const v = validateHandoffInput(input);
  if (!v.ok) return { ok: false, reason: "invalid_input", detail: v.error };
  const { inviteId, confirmEmail } = v.value;

  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "not_configured" };

  const { data: invite, error: inviteErr } = await admin
    .from("org_invites")
    .select(
      "id, status, invited_email, intended_owner_email, provisioned_org_id, provisioned_user_id",
    )
    .eq("id", inviteId)
    .maybeSingle();
  if (inviteErr || !invite) return { ok: false, reason: "not_found" };

  const row = invite as {
    id: string;
    status: string;
    invited_email: string | null;
    intended_owner_email: string | null;
    provisioned_org_id: string | null;
    provisioned_user_id: string | null;
  };
  if (row.status === "handed_off") return { ok: false, reason: "already_handed_off" };
  if (row.status !== "provisioned" || !row.provisioned_org_id || !row.provisioned_user_id) {
    return { ok: false, reason: "not_found" };
  }

  const intended = (row.intended_owner_email ?? "").trim().toLowerCase();
  if (!intended) return { ok: false, reason: "missing_intended_owner" };
  if (intended !== confirmEmail) return { ok: false, reason: "email_mismatch" };

  const { error: updateErr } = await admin.auth.admin.updateUserById(
    row.provisioned_user_id,
    { email: intended, email_confirm: true },
  );
  if (updateErr) {
    const msg = updateErr.message ?? "";
    if (/already|registered|exists|duplicate/i.test(msg)) {
      return { ok: false, reason: "already_has_account", detail: msg };
    }
    return { ok: false, reason: "update_failed", detail: msg };
  }

  let inviteLink: string | null = null;
  try {
    const { data: link } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: intended,
      options: { redirectTo: `${APP_URL}/auth/callback?next=/reset-password` },
    });
    inviteLink =
      (link as { properties?: { action_link?: string } } | null)?.properties
        ?.action_link ?? null;
  } catch {
    inviteLink = null;
  }

  const nowIso = new Date().toISOString();
  const { error: orgUpdateErr } = await admin
    .from("organizations")
    .update({
      concierge: false,
      concierge_contact_confirmed_at: nowIso,
      reply_to_email: intended,
      public_contact_email: intended,
    })
    .eq("id", row.provisioned_org_id);
  if (orgUpdateErr) {
    return { ok: false, reason: "update_failed", detail: orgUpdateErr.message };
  }

  const { error: inviteUpdateErr } = await admin
    .from("org_invites")
    .update({
      status: "handed_off",
      handed_off_at: nowIso,
      handed_off_to_email: intended,
      accepted_at: nowIso,
    })
    .eq("id", row.id);
  if (inviteUpdateErr) {
    return { ok: false, reason: "update_failed", detail: inviteUpdateErr.message };
  }

  return { ok: true, email: intended, inviteLink };
}
