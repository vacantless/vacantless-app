import type { ReactNode } from "react";

// CollapsibleSection — shared disclosure section (S283).
// Generalized from the rental-page collapse (S280) so the long tenancy detail
// page can collapse down to a scannable stack of section headers, each showing
// a short status line so the operator sees state without expanding.
//
// Built on the native <details>/<summary> element so it works with JavaScript
// disabled, is keyboard-accessible, and keeps its content in the DOM when
// collapsed (so any in-page anchor inside a closed section still resolves).
export function CollapsibleSection({
  id,
  title,
  status,
  done = false,
  defaultOpen = false,
  children,
}: {
  /** Anchor id — in-page links can deep-link here. */
  id?: string;
  title: string;
  /** Short status line shown on the right of the header (state at a glance). */
  status?: ReactNode;
  /** Renders a check when this section's job is complete. */
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
