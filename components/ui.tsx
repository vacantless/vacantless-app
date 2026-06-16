import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared SaaS UI primitives. Server-component friendly (no client state) so
 * they drop into any dashboard page. The goal is consistent spacing, card
 * padding, type scale, status chips, page headers, stat tiles, and empty
 * states — a calm, Stripe/Linear feel that carries the marketing homepage's
 * identity (soft 2xl cards, brand icon tiles, eyebrow labels) through every
 * portal page. Brand color flows from the --brand-color CSS var set on the
 * dashboard shell, so every accent stays tenant-aware.
 */

// --- Shared action class tokens ----------------------------------------------

/** Primary action button/link — pair with the brand bg (style or bg-brand). */
export const PRIMARY_ACTION_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90";

/** Secondary action button/link — quiet outline. */
export const SECONDARY_ACTION_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50";

// --- Card --------------------------------------------------------------------

export function Card({
  children,
  className = "",
  padded = true,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Adds a subtle lift on hover — for cards that link somewhere. */
  hover?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${
        padded ? "p-5" : ""
      } ${
        hover ? "transition hover:-translate-y-0.5 hover:shadow-md" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

// --- Icon tile ---------------------------------------------------------------

/**
 * A brand-colored rounded tile for a line icon — the homepage's signature
 * "icon in a soft square" mark, recolored to the tenant brand for the portal.
 */
export function IconTile({
  children,
  className = "",
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  const dims = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center rounded-xl text-white shadow-sm ring-1 ring-black/5 ${className}`}
      style={{ background: "var(--brand-gradient, var(--brand-color))" }}
    >
      {children}
    </span>
  );
}

// --- Brand banner (gradient hero) -------------------------------------------

/**
 * A gradient hero band that carries the marketing homepage's signature look
 * into a portal page header. White text on the tenant's brand ombre (or solid),
 * both legibility-guarded via --brand-gradient. Use at the very top of the
 * highest-traffic pages (Overview, Reports) for depth; quieter pages keep the
 * plain PageHeader.
 */
export function BrandBanner({
  title,
  subtitle,
  eyebrow,
  icon,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl p-6 text-white shadow-md"
      style={{ background: "var(--brand-gradient, var(--brand-color))" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          {icon && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/80">
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/90">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Page header -------------------------------------------------------------

/**
 * A consistent page header: optional brand icon tile, an uppercase eyebrow, the
 * title, a one-line subtitle, and an optional right-aligned action area. Use at
 * the top of every dashboard page so the whole portal shares one rhythm.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3.5">
        {icon && <IconTile>{icon}</IconTile>}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
      )}
    </div>
  );
}

// --- Stat tile ---------------------------------------------------------------

/**
 * A headline metric tile (the dashboard overview + reports KPIs). Soft 2xl
 * surface with an optional brand-tinted icon, the value, and a hint line.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </p>
        {icon && (
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--brand-color) 12%, white)",
              color: "var(--brand-color)",
            }}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
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
    case "paused":
      return "warn";
    case "leased":
      return "info";
    case "draft":
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
  icon,
}: {
  title: string;
  description?: ReactNode;
  cta?: { href: string; label: string };
  /** Optional line icon shown in a soft brand-tinted circle above the title. */
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      {icon && (
        <span
          className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--brand-color) 12%, white)",
            color: "var(--brand-color)",
          }}
        >
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          {description}
        </p>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
