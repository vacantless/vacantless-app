import Link from "next/link";
import type { LaunchChecklist as Checklist } from "@/lib/onboarding";

/**
 * Overview launch checklist + next-best-action, shown only while setup is
 * incomplete. The single "current" step is visually promoted with a primary
 * CTA (that's the next best action), so we don't duplicate a separate card.
 */
export function LaunchChecklist({ checklist }: { checklist: Checklist }) {
  if (checklist.allComplete) return null;

  const { steps, completedCount, totalCount, nextStep } = checklist;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <section className="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Get set up
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {nextStep ? (
                <>
                  Next step:{" "}
                  <span className="font-medium text-gray-700">
                    {nextStep.label}
                  </span>
                </>
              ) : (
                "You're almost there."
              )}
            </p>
          </div>
          <span className="text-sm font-medium text-gray-500">
            {completedCount} of {totalCount} done
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: "var(--brand-color)" }}
          />
        </div>
      </div>

      <ol className="divide-y divide-gray-100">
        {steps.map((step, i) => {
          const isCurrent = step.status === "current";
          const isComplete = step.status === "complete";
          return (
            <li
              key={step.key}
              className={`flex items-start gap-3 px-5 py-3.5 ${
                isCurrent ? "bg-gray-50" : ""
              }`}
            >
              <StepMarker index={i + 1} status={step.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    isComplete ? "text-gray-400 line-through" : "text-gray-900"
                  }`}
                >
                  {step.label}
                </p>
                {!isComplete && (
                  <p className="mt-0.5 text-sm text-gray-500">
                    {step.description}
                  </p>
                )}
              </div>
              {isCurrent && (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: "var(--brand-color)" }}
                >
                  {step.cta}
                </Link>
              )}
              {step.status === "todo" && (
                <Link
                  href={step.href}
                  className="shrink-0 self-center text-sm font-medium text-gray-400 hover:text-brand"
                >
                  {step.cta} →
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepMarker({
  index,
  status,
}: {
  index: number;
  status: "complete" | "current" | "todo";
}) {
  if (status === "complete") {
    return (
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: "var(--brand-color)" }}
        aria-label="Complete"
      >
        ✓
      </span>
    );
  }
  if (status === "current") {
    return (
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2"
        style={{
          color: "var(--brand-color)",
          // ring uses the brand color via boxShadow so it tracks the tenant
          boxShadow: "inset 0 0 0 2px var(--brand-color)",
        }}
      >
        {index}
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-400">
      {index}
    </span>
  );
}
