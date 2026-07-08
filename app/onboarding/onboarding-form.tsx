"use client";

import { useState } from "react";
import {
  brandGradientCss,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_SECONDARY,
} from "@/lib/brand-theme";
import BrandColorField from "@/components/brand-color-field";
import { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from "@/components/auth-shell";

/**
 * Create-workspace form with a live renter-brand preview. The brand can be a
 * solid OR a two-stop ombre; BrandColorField owns the picker and posts the
 * `brand_color` + `brand_color_secondary` hidden inputs. The colors are run
 * through the legibility guard (brandGradientCss) so the preview header/button
 * match exactly what renters will see (a pale pick is darkened just enough to
 * keep white text readable).
 *
 * The server action is passed in as a prop so the page stays a server
 * component and the redirect-based createOrganization flow is unchanged.
 */
export function OnboardingForm({
  action,
  error,
  referralToken,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string;
  referralToken?: string;
}) {
  const [name, setName] = useState("");
  // A brand-new org starts on the homepage forest-green ombre; the picker
  // opens in Ombre mode seeded to match. The tenant can switch to a solid or
  // any other ombre before creating the account.
  const [primary, setPrimary] = useState(DEFAULT_BRAND_COLOR);
  const [secondary, setSecondary] = useState<string | null>(DEFAULT_BRAND_SECONDARY);
  const brandBg = brandGradientCss(primary, secondary);
  const displayName = name.trim() || "Your business";

  return (
    <form action={action} className="mt-6 space-y-5">
      {/* Referral attribution: carries the ?ref token into createOrganization,
          which flips the referrer's pending invite to accepted (best-effort). */}
      {referralToken && <input type="hidden" name="ref" value={referralToken} />}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Business name
        </label>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your rental business"
          className={AUTH_INPUT_CLASS}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Brand color
        </label>
        <p className="mb-2 text-sm text-gray-500">
          Used on your renter pages and emails. Pick a solid or an ombre.
        </p>
        <BrandColorField
          defaultPrimary={DEFAULT_BRAND_COLOR}
          defaultSecondary={DEFAULT_BRAND_SECONDARY}
          onChange={(p, s) => {
            setPrimary(p);
            setSecondary(s);
          }}
        />
      </div>

      {/* Live renter-brand preview */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
          Renter preview
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
          <div className="px-4 py-3" style={{ background: brandBg }}>
            <span className="text-sm font-semibold text-white">
              {displayName}
            </span>
          </div>
          <div className="bg-white px-4 py-3">
            <p className="text-sm font-medium text-gray-900">
              2 bedroom apartment
            </p>
            <p className="text-xs text-gray-500">Book a viewing online</p>
            <span
              className="mt-2 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: brandBg }}
            >
              Book a viewing
            </span>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className={AUTH_BUTTON_CLASS}>
        Save and continue
      </button>
    </form>
  );
}
