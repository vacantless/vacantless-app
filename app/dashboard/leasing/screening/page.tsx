import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { SCREENING_REASON } from "@/lib/screening";
import {
  questionTypeLabel,
  type ScreeningQuestion,
} from "@/lib/screening-questions";
import {
  updateScreening,
  addScreeningQuestion,
  deleteScreeningQuestion,
} from "@/app/dashboard/settings/actions";
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
  const sp = searchParams.screening;
  const org = await getCurrentOrg();
  if (!org) return null;

  // Operator-authored custom questions (S291). RLS scopes this to the org.
  const supabase = createClient();
  const { data: questionRows } = await supabase
    .from("org_screening_questions")
    .select("id, prompt, qtype, required")
    .eq("organization_id", org.id)
    .eq("active", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  const questions = (questionRows ?? []) as ScreeningQuestion[];

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

        {/* --- Custom questions (S291) -------------------------------------
            Operator-authored questions that render on the public inquiry form
            alongside the three built-ins. Informational: the answers show on
            each inquiry but never auto-flag a renter. --- */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.users className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Your own questions
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Add your own questions to the inquiry form — anything you want to know
            up front, like where someone works or whether they smoke. The answers
            appear on each inquiry. They&apos;re for your reference only and never
            auto-flag anyone.
          </p>
          {!org.screening_enabled && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Your questions only show on the public form while{" "}
              <span className="font-medium">
                &ldquo;Ask qualifying questions&rdquo;
              </span>{" "}
              (above) is turned on.
            </p>
          )}

          {sp === "question_added" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Question added.
            </div>
          )}
          {sp === "question_deleted" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Question removed. Inquiries you already received keep their answers.
            </div>
          )}
          {sp === "question_prompt" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              Enter a question between 1 and 200 characters.
            </div>
          )}
          {sp === "question_qtype" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              Pick a valid answer type.
            </div>
          )}

          {questions.length > 0 ? (
            <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {questions.map((q) => (
                <li
                  key={q.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">
                      {q.prompt}
                    </p>
                    <p className="text-xs text-gray-400">
                      {questionTypeLabel(q.qtype)}
                    </p>
                  </div>
                  <form action={deleteScreeningQuestion}>
                    <input type="hidden" name="question_id" value={q.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-400">
              No custom questions yet. Add one below.
            </p>
          )}

          {/* Add a question */}
          <form
            action={addScreeningQuestion}
            className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-end"
          >
            <label className="block flex-1">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                New question
              </span>
              <input
                name="prompt"
                type="text"
                required
                maxLength={200}
                placeholder="e.g. Where do you work?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Answer type
              </span>
              <select
                name="qtype"
                defaultValue="text"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-36"
              >
                <option value="text">Short text</option>
                <option value="yesno">Yes / no</option>
              </select>
            </label>
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm">
              Add question
            </button>
          </form>

          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Keep questions about the rental, not the person — ask only what helps
            you match the right renter to the home, never protected details like
            background, family, or where someone is from.
          </p>
        </div>
      </div>
    </div>
  );
}
