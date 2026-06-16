import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared first-impression chrome for the login / signup / onboarding screens.
 *
 * These three pages run BEFORE any tenant brand exists (you're logging in or
 * creating the workspace), so - like the marketing landing page - they are NOT
 * brand-scoped. We therefore use the same named-color indigo->teal gradient
 * vocabulary as app/page.tsx for brand flourish, never `bg-brand/NN` alpha
 * tricks (those no-op over the hex-valued --brand-color var; KEY_INSIGHTS 327).
 *
 * Purely presentational + no hooks, so it can be rendered from both the server
 * component (onboarding) and the client components (login/signup).
 */

/** Vacantless house-mark wordmark, identical to the landing header. */
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-teal-500 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
          <path
            d="M3 11.5 12 4l9 7.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M5 10v9.5h14V10"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 19.5v-5h5v5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-gray-900">
        Vacantless
      </span>
    </Link>
  );
}

/**
 * Full-screen gradient backdrop + centered card used by every auth screen.
 *
 * @param eyebrow  small uppercase label above the title (e.g. "Step 1 of 2")
 * @param title    card heading
 * @param subtitle one-line supporting copy under the title
 * @param children the form / body
 * @param footer   optional content rendered below the card (e.g. the
 *                 "No account? Sign up" switch link)
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  maxWidth = "max-w-md",
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      {/* layered background for depth, matching the landing hero */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-50 via-white to-white" />
        <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl" />
        <div className="absolute right-0 top-10 h-96 w-96 rounded-full bg-teal-300/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-violet-200/30 blur-3xl" />
      </div>

      <div
        className={`mx-auto flex min-h-screen w-full ${maxWidth} flex-col justify-center px-6 py-12`}
      >
        <div className="mb-7">
          <Wordmark />
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white/90 p-7 shadow-xl shadow-indigo-100/50 backdrop-blur sm:p-8">
          {eyebrow ? (
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {subtitle}
            </p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>

        {footer ? (
          <div className="mt-5 text-center text-sm text-gray-600">{footer}</div>
        ) : null}

        {/* trust strip, echoing the landing proof strip */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-gray-400">
          <TrustItem>Reply in seconds</TrustItem>
          <TrustItem>One link to share</TrustItem>
          <TrustItem>Every renter tracked</TrustItem>
        </div>
      </div>
    </div>
  );
}

function TrustItem({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-teal-500" />
      {children}
    </span>
  );
}

/** Full-width gradient submit button, matching the landing CTAs. */
export const AUTH_BUTTON_CLASS =
  "w-full rounded-lg bg-gradient-to-r from-indigo-600 to-teal-500 px-4 py-2.5 font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-50";

/** Shared text-input styling for the auth forms. */
export const AUTH_INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";
