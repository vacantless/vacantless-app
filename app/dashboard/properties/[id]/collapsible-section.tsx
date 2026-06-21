import type { ReactNode } from "react";

// CollapsibleSection — IA Step 4 slice 2 (S280). The rental page is the
// lifecycle spine made tangible: each of the three on-page rail steps (Set up,
// Market, Inquiries) becomes a collapsible section, so the page collapses down
// to the rail and the operator expands only the step they're working on.
//
// Built on the native <details>/<summary> disclosure element so it works with
// JavaScript disabled, is keyboard-accessible, and keeps its content in the DOM
// when collapsed (so deep-link anchors inside a closed section still resolve).
// SectionDeeplinkOpener opens the right section when a rail step, the
// next-action CTA, or a readiness link deep-links into it.
export function CollapsibleSection({
  id,
  title,
  status,
  done = false,
  defaultOpen = false,
  children,
}: {
  /** Anchor id — rail steps / CTAs deep-link here; also opened by the enhancer. */
  id?: string;
  title: string;
  /** Short status line (mirrors the matching rail step's detail). */
  status?: ReactNode;
  /** Whether this lifecycle step is already done (renders a check). */
  done?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="group mb-6 scroll-mt-6">
      <summary className="mb-4 flex cursor-pointer select-none list-none items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        {/* Caret points right when collapsed, rotates down when open. */}
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90"
        >
          <path
            d="m8 6 4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        {status != null && (
          <span className="ml-auto truncate text-xs font-medium text-gray-500">
            {status}
          </span>
        )}
        {done && (
          <span
            aria-label="Done"
            className={`${status != null ? "ml-2" : "ml-auto"} flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-white`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.29 3.29 6.8-6.8a1 1 0 0 1 1.41 0Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        )}
      </summary>
      <div>{children}</div>
    </details>
  );
}
