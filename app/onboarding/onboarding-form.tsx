"use client";

import { useState } from "react";
import { accessibleBrand } from "@/lib/brand-theme";
import { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from "@/components/auth-shell";

const DEFAULT_BRAND_COLOR = "#4f46e5";

/**
 * Create-workspace form with a live renter-brand preview. The brand color the
 * owner picks is run through accessibleBrand() so the preview header/button
 * match exactly what renters will see after the S180 contrast guardrail
 * (a pale pick is darkened just enough to keep white text readable).
 *
 * The server action is passed in as a prop so the page stays a server
 * component and the redirect-based createOrganization flow is unchanged.
 */
export function OnboardingForm({
  action,
  error,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_BRAND_COLOR);
  const accessible = accessibleBrand(color);
  const displayName = name.trim() || "Your business";

  return (
    <form action={action} className="mt-6 space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Business name
        </label>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agile Real Estate Group"
          className={AUTH_INPUT_CLASS}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Brand color
        </label>
        <div className="flex items-center gap-3">
          <input
            name="brand_color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-20 rounded border border-gray-300"
          />
          <span className="text-sm text-gray-500">
            Used on your renter pages and emails.
          </span>
        </div>
      </div>

      {/* Live renter-brand preview */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
          Renter preview
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
          <div
            className="px-4 py-3"
            style={{ backgroundColor: accessible }}
          >
            <span className="text-sm font-semibold text-white">
              {displayName}
            </span>
          </div>
          <div className="bg-white px-4 py-3">
            <p className="text-sm font-medium text-gray-900">
              2 bedroom apartment
            </p>
            <p className="text-xs text-gray-500">Book a showing online</p>
            <span
              className="mt-2 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: accessible }}
            >
              Book a showing
            </span>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className={AUTH_BUTTON_CLASS}>
        Create my account
      </button>
    </form>
  );
}
