import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { updatePolicyProfile } from "@/app/dashboard/settings/actions";
import {
  LEASE_TERM_OPTIONS,
  leaseTermLabel,
  SMOKING_OPTIONS,
  smokingLabel,
  AC_TYPE_OPTIONS,
  acTypeLabel,
} from "@/lib/property-features";
import { BrandBanner, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Building standard policy — IA Step 3 (S275). Relocated out of Settings →
// Public Page & Brand (G6: it was a non-brand config crammed into the brand
// tab) to its point-of-use: the Rentals/building context. It IS a building
// attribute — the org-level defaults every unit inherits (lease term / A/C /
// smoking / on-site management) — so it belongs alongside the portfolio it
// governs. The editor moved whole (same `updatePolicyProfile` action, now
// redirecting back here); Settings keeps a one-line bridge. Nav highlights
// "Rentals" (path under /dashboard/properties).
//
// Org-level for now (migration 0048, slice 1). The paused per-building override
// (slice 2) lands here too when it ships — this is the surface it slots into.
// ============================================================================

export default async function StandardPolicyPage({
  searchParams,
}: {
  searchParams: { policy?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  return (
    <div>
      <BrandBanner
        eyebrow="Rentals"
        title="Building standard policy"
        subtitle="Set your building's standard policy once. Every unit inherits it on its listings, copy, and syndication feed — so you only re-enter a value where a unit genuinely differs."
        icon={<Icons.building className="h-6 w-6" />}
      />

      <p className="mt-4 text-sm text-gray-500">
        <Link href="/dashboard/properties" className="font-medium text-brand underline">
          ← Back to Rentals
        </Link>
      </p>

      <div className="mt-6 max-w-2xl">
        {/* --- Building standard policy (0048), relocated verbatim from Settings --- */}
        <form
          action={updatePolicyProfile}
          className="rounded-2xl border border-gray-200 bg-white p-5"
        >
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Building standard policy
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Set your building&apos;s standard policy once. Every unit inherits
            these on its listings, copy, and syndication feed — so you only
            re-enter a value on a unit that genuinely differs. (You can override
            any of these per unit on the unit&apos;s own page.)
          </p>

          {searchParams.policy === "saved" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Standard policy saved.
            </div>
          )}
          {searchParams.policy === "error" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              Something went wrong saving these settings. Please try again.
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Standard lease term
              </span>
              <select
                name="policy_lease_term"
                defaultValue={org.policy_lease_term ?? "1_year"}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                {LEASE_TERM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {leaseTermLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Air conditioning
              </span>
              <select
                name="policy_ac_type"
                defaultValue={org.policy_ac_type ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Not set</option>
                {AC_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "none"
                      ? "No air conditioning"
                      : `A/C: ${acTypeLabel(opt)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Smoking
              </span>
              <select
                name="policy_smoking"
                defaultValue={org.policy_smoking ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Not set</option>
                {SMOKING_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {smokingLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                On-site management
              </span>
              <select
                name="policy_on_site_management"
                defaultValue={
                  org.policy_on_site_management == null
                    ? ""
                    : org.policy_on_site_management
                      ? "true"
                      : "false"
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Not set</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>

          <p className="mt-5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Pet policy and included utilities stay on each unit for now — those
            vary more per suite. This profile covers the building-constant fields
            that were otherwise re-typed for every unit and portal.
          </p>

          <button className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
            Save standard policy
          </button>
        </form>
      </div>
    </div>
  );
}
