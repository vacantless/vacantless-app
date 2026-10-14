// ============================================================================
// signup-copy (S714d). Pure wording and checks for the sign-up page.
//
// Found on S714's new-landlord run:
// - The header said "Start free" to someone who came from "Choose Growth".
// - An email that already had an account ended up signed in to that account
//   with no message. Supabase answers a sign-up for an existing email either
//   with "User already registered" or (with email confirmation on) a user that
//   has no identities. Either way, say so and point to Log in.
// - A visitor who is already signed in saw an empty sign-up form (and Chrome
//   autofilled the other login into it). Say who is signed in instead.
// ============================================================================

export function signupEyebrow(plan: string | null | undefined): string {
  if (plan === "growth") return "Growth plan";
  if (plan === "premium") return "Premium plan";
  return "Start free";
}

export function signupSubtitle(plan: string | null | undefined): string {
  if (plan === "growth" || plan === "premium") {
    return "First, set up your sign-in details. Next you'll name your business, then pick how to pay.";
  }
  return "First, set up your sign-in details. Next you'll name your business. No credit card to start.";
}

export const EXISTING_ACCOUNT_MESSAGE =
  "That email already has a Vacantless login. Log in instead, or use a different email.";

/** True when Supabase's sign-up answer means the email is already registered. */
export function signupHitExistingAccount(input: {
  errorMessage?: string | null;
  identitiesCount?: number | null;
  hasUser: boolean;
}): boolean {
  const msg = (input.errorMessage ?? "").toLowerCase();
  if (msg.includes("already registered") || msg.includes("already been registered") || msg.includes("already exists")) {
    return true;
  }
  // Email confirmation on: an existing email comes back as a user with no identities.
  return input.hasUser && input.identitiesCount === 0;
}

/** S714d: the business-setup page names the real next step for a paid pick. */
export function onboardingNextStep(plan: string | null | undefined): string {
  if (plan === "growth" || plan === "premium") return "Next: choose how to pay, then add your first rental.";
  return "Next: add your first rental.";
}
