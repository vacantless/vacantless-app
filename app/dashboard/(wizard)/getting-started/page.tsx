import Link from "next/link";
import { notFound } from "next/navigation";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  computeOnboardingState,
  type OnboardingWizardStep,
} from "@/lib/onboarding-wizard";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { dismissGettingStarted, markRailStepHandled } from "./actions";
import { FocusActiveStep } from "./focus-step";

export const dynamic = "force-dynamic";

type OnboardingRow = {
  dismissed_at: string | null;
  rail_step_done_at: string | null;
};

type GettingStartedPageProps = {
  searchParams?: { wizard?: string };
};

const FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2";

function stepDomId(step: OnboardingWizardStep["key"]) {
  return step.replace(/_/g, "-");
}

export default async function GettingStartedPage({
  searchParams,
}: GettingStartedPageProps) {
  if (!envFlagEnabled(process.env.ONBOARDING_WIZARD_ENABLED)) {
    notFound();
  }

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return null;

  const [{ count: propertyCount }, { count: tenancyCount }, { data: onboarding }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id),
      supabase
        .from("tenancies")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id),
      supabase
        .from("organization_onboarding")
        .select("dismissed_at, rail_step_done_at")
        .eq("organization_id", org.id)
        .maybeSingle(),
    ]);

  const row = onboarding as OnboardingRow | null;
  const state = computeOnboardingState({
    hasProperty: (propertyCount ?? 0) > 0,
    hasTenancy: (tenancyCount ?? 0) > 0,
    dismissedAt: row?.dismissed_at ?? null,
    railStepDoneAt: row?.rail_step_done_at ?? null,
  });
  const activeStepId = state.nextIncompleteStep
    ? `${stepDomId(state.nextIncompleteStep.key)}-step-heading`
    : null;
  const pct = Math.round((state.completedCount / state.totalCount) * 100);

  return (
    <div>
      <FocusActiveStep stepId={activeStepId} />
      <Link
        href="/dashboard"
        className={`mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline ${FOCUS_CLASS}`}
      >
        ← Today
      </Link>

      <PageHeader
        icon={<Icons.check />}
        eyebrow="Getting started"
        title="Set up your first rental"
        subtitle="Add the first rental, record the tenancy when you are ready, and choose how rent will be collected."
        action={
          !state.isDismissed && !state.isComplete ? (
            <form action={dismissGettingStarted}>
              <button
                type="submit"
                className={`rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 ${FOCUS_CLASS}`}
              >
                Dismiss checklist
              </button>
            </form>
          ) : null
        }
      />

      {searchParams?.wizard === "save_error" && (
        <div
          role="alert"
          aria-labelledby="wizard-error-title"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <h2 id="wizard-error-title" className="font-semibold">
            The checklist could not be updated.
          </h2>
          <p className="mt-1">
            Try the step again, or continue with the linked setup page.
          </p>
          <a href="#rent-rail-step" className={`mt-2 inline-block font-medium underline ${FOCUS_CLASS}`}>
            Go to rent collection step
          </a>
        </div>
      )}

      {searchParams?.wizard === "rail_done" && (
        <p className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Rent collection marked handled.
        </p>
      )}

      {state.isComplete && (
        <p className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Your getting-started checklist is complete.
        </p>
      )}

      {state.isDismissed && !state.isComplete && (
        <p className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          This checklist is dismissed on Today, but you can still finish the steps here.
        </p>
      )}

      <section
        aria-labelledby="wizard-progress-title"
        className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="wizard-progress-title" className="font-semibold text-gray-900">
            Progress
          </h2>
          <span className="text-sm font-medium text-gray-500">
            {state.completedCount} of {state.totalCount} done
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Getting started progress"
          aria-valuemin={0}
          aria-valuemax={state.totalCount}
          aria-valuenow={state.completedCount}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100"
        >
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      <ol className="space-y-4">
        {state.steps.map((step, index) => (
          <WizardStepCard
            key={step.key}
            step={step}
            index={index + 1}
            showInlineError={
              step.key === "rent_rail" && searchParams?.wizard === "save_error"
            }
          />
        ))}
      </ol>
    </div>
  );
}

function WizardStepCard({
  step,
  index,
  showInlineError,
}: {
  step: OnboardingWizardStep;
  index: number;
  showInlineError: boolean;
}) {
  const isCurrent = step.status === "current";
  const isComplete = step.status === "complete";
  const domKey = stepDomId(step.key);
  const headingId = `${domKey}-step-heading`;
  const stepId = `${domKey}-step`;

  return (
    <li>
      <section
        id={stepId}
        aria-labelledby={headingId}
        aria-current={isCurrent ? "step" : undefined}
        className={`rounded-xl border bg-white p-5 shadow-sm ${
          isCurrent ? "border-brand/40 ring-1 ring-brand/20" : "border-gray-200"
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <StepMarker index={index} status={step.status} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id={headingId}
                  tabIndex={isCurrent ? -1 : undefined}
                  className={`text-base font-semibold ${
                    isComplete ? "text-gray-500" : "text-gray-900"
                  } ${FOCUS_CLASS}`}
                >
                  {step.label}
                </h2>
                {step.optional && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    Optional
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">
                {step.description}
              </p>
              {showInlineError && (
                <p className="mt-2 text-sm font-medium text-red-700">
                  This step was not saved. Try again.
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isComplete ? (
              <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-100">
                Done
              </span>
            ) : (
              <Link
                href={step.href}
                className={`inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 ${FOCUS_CLASS}`}
              >
                {step.cta}
              </Link>
            )}
            {step.canMarkHandled && !isComplete && (
              <form action={markRailStepHandled}>
                <button
                  type="submit"
                  className={`inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 ${FOCUS_CLASS}`}
                >
                  Mark handled
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </li>
  );
}

function StepMarker({
  index,
  status,
}: {
  index: number;
  status: OnboardingWizardStep["status"];
}) {
  if (status === "complete") {
    return (
      <span
        aria-label={`Step ${index} complete`}
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
      >
        ✓
      </span>
    );
  }
  if (status === "current") {
    return (
      <span
        aria-label={`Step ${index} current`}
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-brand ring-2 ring-brand"
      >
        {index}
      </span>
    );
  }
  return (
    <span
      aria-label={`Step ${index} not started`}
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500"
    >
      {index}
    </span>
  );
}
