import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { SCREENING_REASON } from "@/lib/screening";
import { updateScreening } from "@/app/dashboard/settings/actions";
import { BrandBanner, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Renter pre-screening — IA Step 3 (S275). Relocated out of Settings → Public
// Page & Brand (which was doing 7 jobs, G6) to its point-of-use: Leasing.
// Pre-screening is a PIPELINE RULE — it governs the qualifying questions on the
// public inquiry form and the auto qualify-out flag on inquiries — so it lives
// where the operator works inquiries, not in org branding. The editor moved
// whole (same `updateScreening` action, now redirecting back here); Settings
// keeps a one-line bridge pointing here. Nav highlights "Leasing" because the
// path is under /dashboard/leasing (dashboard-nav isActive prefix match).
// ============================================================================

export default async function ScreeningSettingsPage({
  searchParams,
}: {
  searchParams: { screening?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  return (
    <div>
      <BrandBanner
        eyebrow="Leasing"
        title="Renter pre-screening"
        subtitle="Qualifying questions on your inquiry form, and who gets auto-flagged. This shapes every inquiry across all your rentals."
        icon={<Icons.users className="h-6 w-6" />}
      />

      <p className="mt-4 text-sm text-gray-500">
        <Link href="/dashboard/leads" className="font-medium text-brand underline">
          ← Back to Inquiries
        </Link>
      </p>

      <div className="mt-6 max-w-2xl">
        {/* --- Renter pre-screening (relocated verbatim from Settings) --- */}
        <form
          action={updateScreening}
          className="rounded-2xl border border-gray-200 bg-white p-5"
        >
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.users className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Renter pre-screening
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Ask a few qualifying questions on your inquiry form and automatically
            flag renters who likely don&apos;t fit — so you can focus your time on
            the ones who do. Flagged inquiries are never hidden or rejected; you
            always decide.
          </p>

          {searchParams.screening === "saved" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Pre-screening settings saved.
            </div>
          )}
          {searchParams.screening === "income_multiple" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              The income multiple must be a positive number (e.g. 3 for 3x rent).
            </div>
          )}
          {searchParams.screening === "max_movein_days" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              The move-in window must be a whole number of days.
            </div>
          )}
          {searchParams.screening === "error" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              Something went wrong saving these settings. Please try again.
            </div>
          )}

          <label className="mt-5 flex items-start gap-3">
            <input
              name="screening_enabled"
              type="checkbox"
              defaultChecked={org.screening_enabled}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm">
              <span className="block font-medium text-gray-700">
                Ask qualifying questions on the inquiry form
              </span>
              <span className="block text-xs text-gray-400">
                Adds optional income, household size, and pet questions to your
                public renter page. Off by default.
              </span>
            </span>
          </label>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Required income (multiple of rent)
              </span>
              <input
                name="screening_income_multiple"
                type="number"
                min={1}
                max={20}
                step={0.5}
                defaultValue={org.screening_income_multiple ?? ""}
                placeholder="e.g. 3"
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-gray-400">
                Flags renters whose stated monthly income is below this multiple
                of the rent. Leave blank to skip.
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Latest move-in (days out)
              </span>
              <input
                name="screening_max_movein_days"
                type="number"
                min={1}
                max={3650}
                step={1}
                defaultValue={org.screening_max_movein_days ?? ""}
                placeholder="e.g. 90"
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-gray-400">
                Flags renters who want to move in further out than this. Leave
                blank to skip.
              </span>
            </label>
          </div>

          <label className="mt-5 flex items-start gap-3">
            <input
              name="screening_flag_pets"
              type="checkbox"
              defaultChecked={org.screening_flag_pets}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm">
              <span className="block font-medium text-gray-700">
                Flag renters with pets on rentals that aren&apos;t pet-friendly
              </span>
              <span className="block text-xs text-gray-400">
                Only applies to a rental whose &ldquo;pet-friendly&rdquo; toggle
                is off.
              </span>
            </span>
          </label>

          {/* Operator-tunable reason copy (S257). Blank keeps the default
              wording shown on a flagged inquiry. Only the operator sees these
              labels — renters never do. */}
          <details className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              Customize the wording shown on flagged inquiries
            </summary>
            <p className="mt-2 text-xs text-gray-400">
              When an inquiry is flagged, you see a short reason. Reword it to
              match your voice, or leave blank to use the default. Only you see
              these — renters never do.
            </p>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Income reason
                </span>
                <input
                  name="screening_reason_income"
                  type="text"
                  maxLength={120}
                  defaultValue={org.screening_reason_income ?? ""}
                  placeholder={SCREENING_REASON.income}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Move-in timing reason
                </span>
                <input
                  name="screening_reason_movein"
                  type="text"
                  maxLength={120}
                  defaultValue={org.screening_reason_movein ?? ""}
                  placeholder={SCREENING_REASON.moveIn}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Pets reason
                </span>
                <input
                  name="screening_reason_pets"
                  type="text"
                  maxLength={120}
                  defaultValue={org.screening_reason_pets ?? ""}
                  placeholder={SCREENING_REASON.pets}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              The wording is saved with each inquiry as it comes in, so editing
              it later won&apos;t change inquiries you already received.
            </p>
          </details>

          <p className="mt-5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Screening uses only ability to pay, timing, and pets — never factors
            like family size, background, or any protected group.
          </p>

          <button className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
            Save pre-screening
          </button>
        </form>
      </div>
    </div>
  );
}
