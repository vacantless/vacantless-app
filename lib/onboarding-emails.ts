// onboarding-emails.ts (S702j). The two emails a new landlord gets after
// signing up, so nobody is left wondering what to do first.
//
//   1. Welcome, right after sign-up: the next step for where they are.
//   2. A nudge one day later, only when they have not reached viewing times yet.
//
// Each account gets each email once (organizations.onboarding_email_step).
// Accounts made before this shipped never get them: the cron passes a cutoff.
// Pure, so the wording and the timing are unit tested.
import type { Stage } from "./new-account-watch";
import { HOW_TO_COUNT_WORD } from "./how-to-videos";
import { MARKETPLACE_HELPER_INSTALL_URL } from "./marketplace-helper";
import { TRANSLATE_HINT_EMAIL } from "./translate-hint";

export type OnboardingEmail = {
  step: 1 | 2;
  subject: string;
  body: string;
  actionLabel: string;
  actionPath: string;
};

// S710: /dashboard/properties/new is a 404 unless ADD_PROPERTY_V2_ENABLED is
// on. Same gate as the in-app links (lib/onboarding-wizard.ts, the Rentals
// page): the flag picks the new page, otherwise the inline add form.
export const ADD_RENTAL_V2_PATH = "/dashboard/properties/new";
export const ADD_RENTAL_FALLBACK_PATH = "/dashboard/properties#add-rental";

/** The add-a-rental link for this deploy. Pure. */
export function addRentalPath(addPropertyV2Enabled: boolean): string {
  return addPropertyV2Enabled ? ADD_RENTAL_V2_PATH : ADD_RENTAL_FALLBACK_PATH;
}

/** Where to send a landlord for their next step. */
const NEXT_ACTION: Record<Stage, { label: string; path: string; line: string } | null> = {
  signed_up: {
    label: "Add your rental",
    path: ADD_RENTAL_FALLBACK_PATH,
    line: "Add your rental. The address, the rent and a few photos are enough.",
  },
  rental_added: {
    label: "Put your rental live",
    path: "/dashboard/properties",
    line: "Put your rental live. That gives it a page renters can book from.",
  },
  live: {
    label: "Set viewing times",
    path: "/dashboard/availability",
    line: "Set the times you can show the rental. Renters can only book times you open.",
  },
  viewing_times: {
    label: "Copy your rental link",
    path: "/dashboard/properties",
    line: "Paste your rental link into your ads. Every renter who taps it can book a viewing.",
  },
  first_enquiry: null,
  first_booking: null,
};

export function decideOnboardingEmail(args: {
  stage: Stage;
  daysSinceSignup: number;
  stepSent: number;
  /** ADD_PROPERTY_V2_ENABLED, read by the caller. Off = the inline add form. */
  addPropertyV2Enabled?: boolean;
  /** S834a: signed up on "Just collecting rent?" (organizations.signup_source.intent). */
  rentOnly?: boolean;
  /** S834a: tenancies in the account; the rent nudge stops once there is one. */
  tenancies?: number;
}): OnboardingEmail | null {
  if (args.rentOnly) return decideRentOnboardingEmail(args.stepSent, args.daysSinceSignup, args.tenancies ?? 0);
  const base = NEXT_ACTION[args.stage];
  const next =
    base && args.stage === "signed_up"
      ? { ...base, path: addRentalPath(args.addPropertyV2Enabled === true) }
      : base;

  if (args.stepSent < 1) {
    const steps = [
      "1. Add your rental.",
      "2. Set the times you can show it.",
      "3. Connect your rental sites. One site is enough to begin: your Facebook Page, the helper for Marketplace, Kijiji, Rentals.ca or Zumper. Add the others later.",
      "4. Press Set Live. We post it on every site you connected.",
    ].join("\n");
    const nextLine = next
      ? `Your next step: ${next.line}`
      : "You already have renters coming in. Your list of renters is on your dashboard.";
    return {
      step: 1,
      subject: "Welcome to Vacantless: your first renter in 4 steps",
      body: [
        "Thanks for signing up. Here is how to get your first renter booked, in four steps.",
        steps,
        "After that, every renter gets an answer right away. They book a viewing on their own, and you get an email.",
        // S726: one link to the how-to videos (count from lib/how-to-videos).
        `Prefer to watch? ${HOW_TO_COUNT_WORD} short videos, about a minute each: https://www.vacantless.com/how-to`,
        // S751: the Chrome helper was only findable on a rental's Marketplace row.
        `Facebook Marketplace is where most renters look. Facebook only lets a person press Post there. On a computer, add the free Vacantless helper to Chrome once. It fills in the ad and photos, and you press Post: ${MARKETPLACE_HELPER_INSTALL_URL}`,
        // S817d: Marketplace renters write in Messenger; answer them from the phone.
        "Marketplace renters write back in Messenger. Open Quick replies in Vacantless. Tap Show a code for my phone, and scan it. One tap on the phone sets it up. Then share a chat screenshot. It saves the renter and copies your reply.",
        nextLine,
        // S821e: the app reads well through Chrome's translator.
        TRANSLATE_HINT_EMAIL,
        "Reply to this email if you get stuck. I read every one.",
        "Noam, founder of Vacantless",
      ].join("\n\n"),
      actionLabel: next?.label ?? "Open your dashboard",
      actionPath: next?.path ?? "/dashboard",
    };
  }

  if (args.stepSent < 2 && args.daysSinceSignup >= 1) {
    // Only nudge when they are stuck before the rental can take bookings.
    if (args.stage !== "signed_up" && args.stage !== "rental_added" && args.stage !== "live") {
      return null;
    }
    const n = next!;
    return {
      step: 2,
      subject: "One step to your first booking",
      body: [
        "You are close. One thing stands between you and your first booked viewing.",
        n.line,
        "It takes a few minutes. Reply to this email if anything is unclear and I will help.",
        "Noam, founder of Vacantless",
      ].join("\n\n"),
      actionLabel: n.label,
      actionPath: n.path,
    };
  }

  return null;
}

// S834a: the rent-only path ("Just collecting rent?", /signup?plan=rent). The
// leasing welcome told these landlords to add photos and connect rental sites.
export const RENT_FIRST_STEP_PATH = "/dashboard/tenancies/new";

export function decideRentOnboardingEmail(
  stepSent: number,
  daysSinceSignup: number,
  tenancies: number,
): OnboardingEmail | null {
  if (stepSent < 1) {
    const steps = [
      "1. Add your tenant: the rental's address, the rent and your tenant's name and email.",
      "2. Connect your own Stripe account, which has no monthly fee. Or Rotessa, if you have 6 rentals or more.",
      "3. Send your tenant the bank link. They set up the pre-authorized debit once, and rent comes in on the day you pick.",
    ].join("\n");
    return {
      step: 1,
      subject: "Welcome to Vacantless: rent collection in 3 steps",
      body: [
        "Thanks for signing up. Here is how to have rent come in on its own, in three steps.",
        steps,
        "Rent goes straight into your own account, and Vacantless adds no fee. You see who paid and who owes. No cheques to pick up or deposit, and nothing to remember each month.",
        tenancies > 0
          ? "Your next step: open your tenant and connect Stripe."
          : "Your next step: add your tenant. The address, the rent and their email are enough.",
        TRANSLATE_HINT_EMAIL,
        "Reply to this email if you get stuck. I read every one.",
        "Noam, founder of Vacantless",
      ].join("\n\n"),
      actionLabel: tenancies > 0 ? "Open your tenants" : "Add your tenant",
      actionPath: tenancies > 0 ? "/dashboard/tenancies" : RENT_FIRST_STEP_PATH,
    };
  }
  if (stepSent < 2 && daysSinceSignup >= 1 && tenancies === 0) {
    return {
      step: 2,
      subject: "One step to collecting rent",
      body: [
        "You are close. Add your tenant and rent can start coming in on its own.",
        "The rental's address, the rent and your tenant's name and email are enough.",
        "It takes a few minutes. Reply to this email if anything is unclear and I will help.",
        "Noam, founder of Vacantless",
      ].join("\n\n"),
      actionLabel: "Add your tenant",
      actionPath: RENT_FIRST_STEP_PATH,
    };
  }
  return null;
}
