import Link from "next/link";
import type { OnboardingWizardState } from "@/lib/onboarding-wizard";
import { Icons } from "@/components/icons";
import { dismissGettingStarted } from "./(wizard)/getting-started/actions";

export function GettingStartedCard({
  state,
}: {
  state: OnboardingWizardState;
}) {
  if (!state.shouldShowCard) return null;

  const pct = Math.round((state.completedCount / state.totalCount) * 100);
  const next = state.nextIncompleteStep;

  return (
    <section
      aria-labelledby="getting-started-card-title"
      className="mb-8 rounded-xl border border-brand/20 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
            <Icons.check className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="getting-started-card-title" className="font-semibold text-gray-900">
              Getting started
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              {next
                ? `Next: ${next.label}.`
                : "You are almost finished."}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div
                role="progressbar"
                aria-label="Getting started progress"
                aria-valuemin={0}
                aria-valuemax={state.totalCount}
                aria-valuenow={state.completedCount}
                className="h-2 w-36 overflow-hidden rounded-full bg-gray-100"
              >
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-500">
                {state.completedCount} of {state.totalCount} done
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/dashboard/getting-started"
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2"
          >
            Open checklist
          </Link>
          <form action={dismissGettingStarted}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2"
            >
              Dismiss
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
