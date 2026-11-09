"use client";

import { useState } from "react";
import { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from "@/components/auth-shell";
import { SubmitButton } from "@/components/submit-button";

/**
 * Create-workspace form: business name and the phone renters see. The brand
 * colour picker lived here until S770; it is in Settings, Public page now,
 * and a new account starts on the default green (createOrganization's
 * defaults when the colour fields are absent).
 *
 * The server action is passed in as a prop so the page stays a server
 * component and the redirect-based createOrganization flow is unchanged.
 */
export function OnboardingForm({
  action,
  error,
  referralToken,
  planIntent,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string;
  referralToken?: string;
  planIntent?: string;
}) {
  const [name, setName] = useState("");

  return (
    <form action={action} className="mt-6 space-y-5">
      {/* Referral attribution: carries the ?ref token into createOrganization,
          which flips the referrer's pending invite to accepted (best-effort). */}
      {referralToken && <input type="hidden" name="ref" value={referralToken} />}
      {/* Paid-plan intent from the pricing CTA -> billing after onboarding. */}
      {planIntent && <input type="hidden" name="plan" value={planIntent} />}
      <div>
        <label
          htmlFor="business-name"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Business name
        </label>
        <input
          id="business-name"
          name="name"
          required
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your rental business"
          className={AUTH_INPUT_CLASS}
        />
      </div>

      <div>
        <label
          htmlFor="public-contact-phone"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Phone for renters
        </label>
        <input
          id="public-contact-phone"
          name="public_contact_phone"
          type="tel"
          autoComplete="tel"
          placeholder="519-555-0123"
          className={AUTH_INPUT_CLASS}
        />
        <p className="mt-1 text-xs text-gray-500">
          Rental sites need a phone number before they post your ad. You can
          add it later in Settings.
        </p>
      </div>

      {/* S770 (REVIEW-S770 section 3 item 5): the brand colour picker and its
          preview left this screen. Two fields before the first rental; colours
          and the logo wait in Settings, Public page. createOrganization keeps
          its defaults when the fields are absent. */}
      <p className="text-xs text-gray-500">
        Your logo and colours can wait. Add them any time in Settings.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* S700 (dress rehearsal F2): the plain button gave no feedback during the
          create, so people clicked twice. Disable it and say what is happening. */}
      <SubmitButton className={AUTH_BUTTON_CLASS} pendingLabel="Creating your business...">
        Save and continue
      </SubmitButton>
    </form>
  );
}
