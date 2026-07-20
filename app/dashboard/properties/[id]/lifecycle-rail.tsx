import Link from "next/link";
import { Icons } from "@/components/icons";
import type { RentalLifecycle } from "@/lib/rental-lifecycle";

// The rental lifecycle rail (IA Step 4 slice 1, S278). Read-only: it shows
// where the unit sits, empty -> leased, and what's outstanding, with each step
// deep-linking into the surface where that work happens. See lib/rental-lifecycle.
export function LifecycleRail({ lifecycle }: { lifecycle: RentalLifecycle }) {
  const { steps, completedCount, totalCount, currentStep } = lifecycle;

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Where this rental is
        </h3>
        <span className="text-xs font-medium text-gray-500">
          {currentStep === null
            ? "Fully leased"
            : `${completedCount} of ${totalCount} done`}
        </span>
      </div>

      {/* Horizontal rail. Each step is a link to where its work happens. On
          narrow screens it wraps; the connector line is hidden there. */}
      <ol className="flex flex-wrap gap-y-4">
        {steps.map((s, i) => {
          const isDone = s.state === "done";
          const isCurrent = s.state === "current";

          const circle = isDone
            ? "border-brand bg-brand text-white"
            : isCurrent
              ? "border-brand bg-white text-brand ring-4 ring-brand/10"
              : "border-gray-300 bg-white text-gray-400";

          const connector =
            i === 0
              ? ""
              : steps[i - 1].state === "done"
                ? "bg-brand"
                : "bg-gray-200";

          return (
            <li
              key={s.step}
              className="relative flex min-w-[7rem] flex-1 flex-col items-center text-center"
            >
              {/* connector from the previous step's circle to this one */}
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute left-[-50%] top-4 -z-0 h-0.5 w-full ${connector}`}
                />
              )}

              <Link href={s.href} className="group z-10 flex flex-col items-center">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition ${circle}`}
                >
                  {isDone ? (
                    <Icons.check className="h-4 w-4" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </span>
                <span
                  className={`mt-2 text-xs font-semibold ${
                    isCurrent
                      ? "text-brand"
                      : isDone
                        ? "text-gray-900"
                        : "text-gray-500"
                  } group-hover:underline`}
                >
                  {s.label}
                </span>
                <span className="mt-0.5 px-1 text-[11px] leading-tight text-gray-500">
                  {s.detail}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      {currentStep !== null && (
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <span className="font-medium text-gray-700">Current step:</span>{" "}
          {steps.find((s) => s.step === currentStep)!.label} -{" "}
          {steps.find((s) => s.step === currentStep)!.detail.toLowerCase()}.
        </p>
      )}
    </div>
  );
}
