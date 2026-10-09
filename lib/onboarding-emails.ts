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

export type OnboardingEmail = {
  step: 1 | 2;
  subject: string;
  body: string;
  actionLabel: string;
  actionPath: string;
};

/** Where to send a landlord for their next step. */
const NEXT_ACTION: Record<Stage, { label: string; path: string; line: string } | null> = {
  signed_up: {
    label: "Add your rental",
    path: "/dashboard/properties/new",
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
}): OnboardingEmail | null {
  const next = NEXT_ACTION[args.stage];

  if (args.stepSent < 1) {
    const steps = [
      "1. Add your rental and put it live.",
      "2. Set the times you can show it.",
      "3. Paste your rental link into your ads.",
    ].join("\n");
    const nextLine = next
      ? `Your next step: ${next.line}`
      : "You already have renters coming in. Your list of renters is on your dashboard.";
    return {
      step: 1,
      subject: "Welcome to Vacantless: your first renter in 3 steps",
      body: [
        "Thanks for signing up. Here is how to get your first renter booked.",
        steps,
        "After that, every renter gets an answer right away. They book a viewing on their own, and you get an email.",
        nextLine,
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
