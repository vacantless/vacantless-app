"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

// ---------------------------------------------------------------------------
// Rent-increase guideline (S465). Set the Ontario guideline % for an effective
// year with no redeploy. Double-gated exactly like the onboarding actions: the
// page 404s for non-admins AND this rechecks the superadmin allowlist before the
// service-role write (defense in depth). Writes to rent_guidelines (0135), which
// overrides the code constant ONTARIO_GUIDELINE at runtime.
// ---------------------------------------------------------------------------
export type GuidelineUpsertOutcome =
  | { ok: true; year: number; percent: number }
  | { ok: false; error: string };

export async function upsertRentGuidelineAction(input: {
  year: number;
  percent: number;
}): Promise<GuidelineUpsertOutcome> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) {
    return { ok: false, error: "Not authorized." };
  }

  const year = Math.trunc(Number(input.year));
  const percent = Math.round(Number(input.percent) * 100) / 100;
  if (!Number.isInteger(year) || year < 1991 || year > 2100) {
    return { ok: false, error: "Year must be a whole number between 1991 and 2100." };
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
    return { ok: false, error: "Guideline % must be between 0 and 10." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Service role is not configured." };

  const { error } = await admin.from("rent_guidelines").upsert(
    {
      year,
      percent,
      source: `admin console: ${user?.email ?? "unknown"}`,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "year" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true, year, percent };
}
