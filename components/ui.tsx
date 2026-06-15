import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared SaaS UI primitives. Server-component friendly (no client state) so
 * they drop into any dashboard page. The goal is consistent spacing, card
 * padding, type scale, status chips, and empty states — a calm, Stripe/Linear
 * feel — without a global restyle. Brand color flows from the --brand-color
 * CSS var set on the dashboard shell.
 */

// --- Card --------------------------------------------------------------------

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm ${
        padded ? "p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

// --- Section heading ---------------------------------------------------------

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
        {children}
      </h2>
      {action && (
        <Link
          href={action.href}
          className="text-sm font-medium text-brand hover:underline"
        >
          {action.label} →
        </Link>
      )}
    </div>
  );
}

// --- Status chip -------------------------------------------------------------

export type ChipTone =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "danger"
  | "brand";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "bg-gray-100 text-gray-600 ring-gray-200",
  info: "bg-blue-50 text-blue-700 ring-blue-100",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  warn: "bg-amber-50 text-amber-700 ring-amber-100",
  danger: "bg-red-50 text-red-700 ring-red-100",
  brand: "bg-teal-50 text-teal-700 ring-teal-100",
};

export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: ChipTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Lead pipeline stage -> chip tone (calm, differentiated). */
export function leadStatusTone(status: string): ChipTone {
  switch (status) {
    case "new":
      return "info";
    case "replied":
    case "contacted":
      return "brand";
    case "booked":
    case "showed":
    case "applied":
      return "warn";
    case "leased":
      return "success";
    case "lost":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Property status -> chip tone. */
export function propertyStatusTone(status: string): ChipTone {
  switch (status) {
    case "available":
      return "success";
    case "leased":
      return "info";
    case "off_market":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Showing outcome -> chip tone. */
export function showingOutcomeTone(outcome: string): ChipTone {
  switch (outcome) {
    case "scheduled":
      return "info";
    case "attended":
      return "success";
    case "no_show":
      return "danger";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

// --- Empty state -------------------------------------------------------------

/**
 * A consistent empty state: says what the area is for, why it's empty, and the
 * next action. `cta` renders a primary button link when the user can act.
 */
export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description?: ReactNode;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          {description}
        </p>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm"
          style={{ backgroundColor: "var(--brand-color)" }}
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
