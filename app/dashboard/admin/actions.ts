"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  isAdminEmail,
  type ProvisionOutcome,
  type HandoffOutcome,
} from "@/lib/provisioning";
import {
  provisionLandlordOrg,
  handoffProvisionedOrg,
  adminEmails,
} from "@/lib/provisioning-server";

// Operator-initiated landlord onboarding (the scale version of WORKFLOW 112).
// Double-gated: the page 404s for non-admins, AND this action rechecks the
// superadmin allowlist server-side before touching the admin API (defense in
// depth — never trust the UI gate alone). Returns the outcome to the client
// form so it can render success + the set-password link, or a friendly error.
export async function onboardLandlordAction(
  input: {
    email: string;
    orgName: string;
    landlordName?: string | null;
    concierge?: boolean;
    intendedOwnerEmail?: string | null;
  },
): Promise<ProvisionOutcome> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email, adminEmails())) {
    return { ok: false, reason: "unknown", detail: "Not authorized." };
  }

  const outcome = await provisionLandlordOrg({
    email: input.email,
    orgName: input.orgName,
    landlordName: input.landlordName ?? null,
    concierge: input.concierge === true,
    intendedOwnerEmail: input.intendedOwnerEmail ?? null,
    source: "operator",
  });

  if (outcome.ok) revalidatePath("/dashboard/admin");
  return outcome;
}

export async function handoffLandlordAction(input: {
  inviteId: string;
  confirmEmail: string;
}): Promise<HandoffOutcome> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email, adminEmails())) {
    return { ok: false, reason: "unknown", detail: "Not authorized." };
  }

  const outcome = await handoffProvisionedOrg(input);
  if (outcome.ok) revalidatePath("/dashboard/admin");
  return outcome;
}
