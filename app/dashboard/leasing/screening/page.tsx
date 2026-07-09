import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { SCREENING_REASON, describeScreeningStatus } from "@/lib/screening";
import {
  questionTypeLabel,
  preferredAnswerLabel,
  type ScreeningQuestion,
} from "@/lib/screening-questions";
import {
  updateScreening,
  updateScreeningPreferredAnswer,
  setScreeningQuestionActive,
  deleteScreeningQuestion,
} from "@/app/dashboard/settings/actions";
import { AddQuestionForm } from "./add-question-form";
import { BrandBanner, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Renter pre-screening — IA Step 3 (S275). Relocated out of Settings → Public
// Page & Brand (which was doing 7 jobs, G6) to its point-of-use: Leasing.
// Pre-screening is a PIPELINE RULE — it governs the qualifying questions on the
// public inquiry form and the auto qualify-out flag on inquiries — so it lives
// where the operator works inquiries, not in org branding.
//
// S438 first-time-user UX pass: the page now leads with a plain-language STATUS
// SUMMARY that separates what renters are ASKED from what auto-FLAGS a possible
// mismatch (the two are independent and were previously left to inference), adds
// workflow bridges (preview the renter form / view the flagged inquiries), makes
// the old-vs-new-inquiry snapshot behavior explicit, and lets custom questions be
// PAUSED (turned off) without deleting them. No change to what actually gets
// asked or flagged — the save path (updateScreening) is byte-identical.
// ============================================================================

type CustomQuestionRow = ScreeningQuestion & { active: boolean };

export default async function ScreeningSettingsPage({
  searchParams,
}: {
  searchParams: { screening?: string };
}) {
  const sp = searchParams.screening;
  const org = await getCurrentOrg();
  if (!org) return null;

  const supabase = createClient();

  // Operator-authored custom questions (S291). RLS scopes this to the org. S438:
  // we now read INACTIVE (paused) questions too so the operator can turn one back
  // on without re-authoring it — the list below splits them into on/paused.
  const { data: questionRows } = await supabase
    .from("org_screening_questions")
    .select("id, prompt, qtype, required, preferred_answer, choices, active")
    .eq("organization_id", org.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  const questions = (questionRows ?? []) as CustomQuestionRow[];
  const activeQuestions = questions.filter((q) => q.active);
  const pausedQuestions = questions.filter((q) => !q.active);

  // First available rental for the "Preview renter form" bridge. The public /r
  // page only renders for a live listing (draft/off-market 404), so we link to a
  // genuinely available unit or omit the bridge when there is none.
  const { data: previewProp } = await supabase
    .from("properties")
    .select("id")
    .eq("organization_id", org.id)
    .eq("status", "available")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previewHref = previewProp ? `/r/${previewProp.id}` : null;

  // Plain-language summary of the CURRENT saved config (S438). Pure helper; reads
  // only what the evaluator reads.
  const status = describeScreeningStatus(
    {
      screening_enabled: org.screening_enabled,
      screening_income_multiple: org.screening_income_multiple,
      screening_max_movein_days: org.screening_max_movein_days,
      screening_flag_pets: org.screening_flag_pets,
      screening_reason_income: org.screening_reason_income,
      screening_reason_movein: org.screening_reason_movein,
      screening_reason_pets: org.screening_reason_pets,
    },
    activeQuestions.map((q) => q.prompt),
  );

  return (
    <div>
      <BrandBanner
        eyebrow="Leasing"
        title="Pre-screening settings"
        subtitle="Set up the qualifying questions on your inquiry form and choose which answers get a “possible mismatch” heads-up. This shapes every inquiry across all your rentals."
        icon={<Icons.users className="h-6 w-6" />}
      />

      <p className="mt-4 text-sm text-gray-500">
        <Link href="/dashboard/leads" className="font-medium text-brand underline">
          ← Back to Inquiries
        </Link>
      </p>

      <div className="mt-6 max-w-2xl space-y-6">
        {/* --- Status summary (S438) -------------------------------------------
            Leads the page so a first-time operator can see, in plain language,
            whether screening is on, what renters are ASKED, and what auto-FLAGS a
            possible mismatch — the asked-vs-flagged split is the core confusion
            this page fixes. --- */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Current setup
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                status.enabled
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {status.enabled ? "On for all rentals" : "Off"}
            </span>
          </div>

          {status.enabled ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-medium text-gray-700">
                  Renters are asked
                </dt>
                <dd className="mt-0.5 text-gray-500">
                  {status.askedLabels.join(", ")}.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">
                  Auto-flags a possible mismatch when
                </dt>
                <dd className="mt-0.5 text-gray-500">
                  {status.flagLabels.length > 0
                    ? `${status.flagLabels.join("; ")}.`
                    : "nothing is set to auto-flag yet — questions are asked, but no answer raises a heads-up."}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              Renters aren&apos;t asked any pre-screening questions and nothing is
              auto-flagged. Turn it on below to start.
            </p>
          )}

          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Changes apply to new inquiries only. Existing inquiries keep the
            screening result they had when they came in.
          </p>

          {/* Workflow bridges */}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {previewHref ? (
              <a
                href={previewHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand underline"
              >
                Preview the renter form ↗
              </a>
            ) : (
              <span className="text-xs text-gray-400">
                Preview the renter form — available once you have a live rental.
              </span>
            )}
            <Link
              href="/dashboard/leads?screen=out"
              className="font-medium text-brand underline"
            >
              View possible mismatches →
            </Link>
          </div>
        </div>

        {/* --- Renter pre-screening (built-ins) -------------------------------- */}
        <form
          action={updateScreening}
          className="rounded-2xl border border-gray-200 bg-white p-5"
        >
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.users className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Questions &amp; auto-flags
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Ask a few qualifying questions on your inquiry form and, optionally,
            flag renters whose answers likely don&apos;t fit — so you can focus
            your time on the ones who do. Flagged inquiries are never hidden,
            rejected, or messaged; you always decide.
          </p>

          {sp === "saved" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Pre-screening settings saved.
            </div>
          )}
          {sp === "income_multiple" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              The income multiple must be a positive number (e.g. 3 for 3x rent).
            </div>
          )}
          {sp === "max_movein_days" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              The move-in window must be a whole number of days.
            </div>
          )}
          {sp === "error" && (
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
                Ask pre-screening questions
              </span>
              <span className="block text-xs text-gray-400">
                While this is on, your public renter form asks income, move-in
                date, pets, and number of occupants. Off by default.
              </span>
            </span>
          </label>

          <p className="mt-5 text-xs font-medium uppercase tracking-wider text-gray-400">
            Auto-flag settings
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Asking a question and flagging its answer are separate. Set a value to
            raise a &ldquo;possible mismatch&rdquo; heads-up; leave one blank and
            that question is still asked, it just never flags.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Flag income below (multiple of rent)
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
                Flags a renter whose stated monthly income is below this multiple
                of the rent. Blank = asked, never flags.
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Flag move-in further out than (days)
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
                Flags a renter who wants to move in further out than this. Blank =
                asked, never flags.
              </span>
            </label>
          </div>

          <label className="mt-4 flex items-start gap-3">
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

          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Number of occupants is always asked for your context but never
            auto-flags — occupancy can touch protected family status. Screening
            uses only ability to pay, timing, and pets — never factors like
            family size, background, or any protected group.
          </p>

          {/* Operator-tunable reason copy (S257). */}
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

          <button className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
            Save pre-screening
          </button>
        </form>

        {/* --- Extra questions for your reference (S291 + S438 pause) --------- */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.users className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Extra questions for your reference
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Add your own questions to the inquiry form. The answers appear on each
            inquiry — they&apos;re for your reference only and never auto-flag
            anyone. Ask only questions that help match the renter to the rental,
            such as move-in timing, pets, parking needs, or unit preference.
          </p>
          {!org.screening_enabled && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Your questions only show on the public form while{" "}
              <span className="font-medium">
                &ldquo;Ask pre-screening questions&rdquo;
              </span>{" "}
              (above) is turned on.
            </p>
          )}

          {sp === "question_added" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Question added.
            </div>
          )}
          {sp === "question_paused" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Question turned off. It won&apos;t show on the form until you turn
              it back on. Inquiries you already received keep their answers.
            </div>
          )}
          {sp === "question_resumed" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Question turned back on. New inquiries will be asked it again.
            </div>
          )}
          {sp === "question_deleted" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Question removed. Inquiries you already received keep their answers.
            </div>
          )}
          {sp === "preference_saved" && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
              Preference saved. New inquiries that don&apos;t match will show a
              heads-up — it never rejects anyone.
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
          {sp === "question_choices" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              A multiple-choice question needs at least two answer options (one
              per line).
            </div>
          )}

          {questions.length > 0 ? (
            <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {[...activeQuestions, ...pausedQuestions].map((q) => (
                <li
                  key={q.id}
                  className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                    q.active ? "" : "bg-gray-50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-gray-800">
                      <span className="truncate">{q.prompt}</span>
                      {!q.active && (
                        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
                          Off
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {questionTypeLabel(q.qtype)}
                      {q.qtype === "yesno" && q.preferred_answer && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-500">
                          {preferredAnswerLabel(q.preferred_answer)}
                        </span>
                      )}
                      {q.qtype === "choice" && q.choices.length > 0 && (
                        <span className="ml-1">· {q.choices.join(", ")}</span>
                      )}
                      {q.qtype === "units" && (
                        <span className="ml-1">· auto from your available rentals</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Preferred answer (S293): yes/no only, active questions
                        only (a paused question isn't being asked). */}
                    {q.active && q.qtype === "yesno" && (
                      <form
                        action={updateScreeningPreferredAnswer}
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="question_id" value={q.id} />
                        <label
                          htmlFor={`preferred-answer-${q.id}`}
                          className="text-xs text-gray-500"
                        >
                          You prefer
                        </label>
                        <select
                          id={`preferred-answer-${q.id}`}
                          name="preferred_answer"
                          defaultValue={q.preferred_answer ?? ""}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">No preference</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Save
                        </button>
                      </form>
                    )}

                    {/* Pause / resume (S438). Turning off keeps the definition so
                        it can be turned back on without re-authoring. */}
                    <form action={setScreeningQuestionActive}>
                      <input type="hidden" name="question_id" value={q.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={q.active ? "0" : "1"}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {q.active ? "Turn off" : "Turn on"}
                      </button>
                    </form>

                    {/* Permanent delete — only on an already-off question, so it
                        is a deliberate two-step, never a one-click loss. */}
                    {!q.active && (
                      <form action={deleteScreeningQuestion}>
                        <input type="hidden" name="question_id" value={q.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-400">
              No custom questions yet. Add one below.
            </p>
          )}

          {/* Add a question — progressive-disclosure island (S438) */}
          <AddQuestionForm />
          <p className="mt-2 text-xs text-gray-400">
            A preferred answer applies to yes/no questions only. When an inquiry
            doesn&apos;t match, you&apos;ll see a soft heads-up on it — it never
            rejects, hides, or auto-flags anyone.
          </p>

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
