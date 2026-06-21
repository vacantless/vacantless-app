import Link from "next/link";
import { Icons } from "@/components/icons";
import { PRIMARY_ACTION_CLASS } from "@/components/ui";
import type { NextAction } from "@/lib/rental-next-action";

// The rental lifecycle "next action" card (IA Step 4 slice 3, S279). Sits under
// the read-only rail and turns the current step into a guided, PRE-FILLED prompt:
// what's already been derived/inherited for the operator (confirm, don't
// re-enter — the postal-code cascade), the few gaps still needing them, and one
// primary CTA. Presentational — all logic is in lib/rental-next-action.
export function NextActionCard({ action }: { action: NextAction }) {
  const { title, blurb, derived, gaps, cta } = action;

  return (
    <div className="mb-6 rounded-2xl border border-brand/30 bg-brand/[0.03] p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
          <Icons.bolt className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <p className="text-xs leading-relaxed text-gray-600">{blurb}</p>

      {(derived.length > 0 || gaps.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {derived.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Already filled in
              </h4>
              <ul className="space-y-1.5">
                {derived.map((f) => (
                  <li key={f.key} className="flex items-start gap-2 text-xs">
                    <Icons.check
                      aria-hidden
                      className="mt-px h-3.5 w-3.5 shrink-0 text-green-600"
                    />
                    <span className="min-w-0 text-gray-700">
                      <span className="font-medium text-gray-900">
                        {f.label}:
                      </span>{" "}
                      {f.value}
                      {f.inherited && (
                        <span className="ml-1 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                          from your building defaults
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Still needs you
              </h4>
              <ul className="space-y-1.5">
                {gaps.map((g) => (
                  <li key={g.key} className="flex items-start gap-2 text-xs">
                    <span
                      aria-hidden
                      className="mt-px font-semibold text-amber-600"
                    >
                      ○
                    </span>
                    <span className="min-w-0 font-medium text-gray-900">
                      {g.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <Link href={cta.href} className={`${PRIMARY_ACTION_CLASS} bg-brand`}>
          {cta.label}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
