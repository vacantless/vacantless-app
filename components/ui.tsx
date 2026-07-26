import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

/**
 * Shared SaaS UI primitives. Server-component friendly (no client state) so
 * they drop into any dashboard page. The goal is consistent spacing, card
 * padding, type scale, status chips, page headers, stat tiles, and empty
 * states — a calm, Stripe/Linear feel that carries the marketing homepage's
 * identity (soft 2xl cards, brand icon tiles, eyebrow labels) through every
 * portal page. Brand color flows from the --brand-color CSS var set on the
 * dashboard shell, so every accent stays tenant-aware.
 */

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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
 * both legibility-guarded via --brand-gradient. Used at the top of the primary
 * working pages (Overview, Inquiries, Rentals, Viewing Times, Billing) so the
 * portal consistently carries the homepage depth; small sub-pages and forms keep
 * the plain PageHeader.
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

/** Tenancy status -> chip tone. */
export function tenancyStatusTone(status: string): ChipTone {
  switch (status) {
    case "active":
      return "success";
    case "upcoming":
      return "info";
    case "ended":
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

// --- Presentation kit shells ------------------------------------------------

export function StageShell({
  as = "main",
  children,
  title,
  subtitle,
  eyebrow,
  action,
  className = "",
}: {
  as?: "main" | "section" | "div";
  children?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Shell = as;

  return (
    <Shell
      className={cx(
        "mx-auto flex min-h-screen w-full max-w-[40rem] flex-col px-5 py-8 text-[length:var(--vl-type-guided-body)] leading-[1.6] text-[var(--vl-text-primary)] sm:px-6 sm:py-12",
        className,
      )}
    >
      {(title || subtitle || eyebrow || action) && (
        <header className="mb-8 space-y-3">
          {eyebrow && (
            <p className="text-[length:var(--vl-type-workbench-body)] font-semibold uppercase tracking-wider text-[var(--vl-accent)]">
              {eyebrow}
            </p>
          )}
          {title && (
            <h1 className="text-[length:var(--vl-type-h1)] font-bold leading-tight tracking-normal text-[var(--vl-text-primary)]">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="max-w-2xl text-[length:var(--vl-type-guided-body)] text-[var(--vl-text-secondary)]">
              {subtitle}
            </p>
          )}
          {action && <div className="pt-1">{action}</div>}
        </header>
      )}
      <div className="flex flex-1 flex-col gap-[var(--vl-space-guided)]">
        {children}
      </div>
    </Shell>
  );
}

export function PageShell({
  children,
  title,
  subtitle,
  eyebrow,
  icon,
  action,
  className = "",
}: {
  children?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cx(
        "mx-auto w-full max-w-7xl px-4 py-6 text-[length:var(--vl-type-workbench-body)] leading-[1.55] text-[var(--vl-text-primary)] sm:px-6 lg:px-8",
        className,
      )}
    >
      {(title || subtitle || eyebrow || icon || action) && (
        <PageHeader
          title={title}
          subtitle={subtitle}
          eyebrow={eyebrow}
          icon={icon}
          action={action}
        />
      )}
      <div className="space-y-[var(--vl-space-workbench)]">{children}</div>
    </main>
  );
}

// --- Macro status banner ----------------------------------------------------

export type StatusBannerTone = "success" | "attention" | "neutral" | "info";

export const STATUS_BANNER_TONE_TO_CHIP_TONE: Record<
  StatusBannerTone,
  ChipTone
> = {
  success: "success",
  attention: "warn",
  neutral: "neutral",
  info: "info",
};

const STATUS_BANNER_CLASSES: Record<StatusBannerTone, string> = {
  success:
    "border-[var(--vl-status-success-border)] bg-[var(--vl-status-success-bg)] text-[var(--vl-status-success-text)]",
  attention:
    "border-[var(--vl-status-attention-border)] bg-[var(--vl-status-attention-bg)] text-[var(--vl-status-attention-text)]",
  neutral:
    "border-[var(--vl-status-neutral-border)] bg-[var(--vl-status-neutral-bg)] text-[var(--vl-status-neutral-text)]",
  info: "border-[var(--vl-status-info-border)] bg-[var(--vl-status-info-bg)] text-[var(--vl-status-info-text)]",
};

export function StatusBanner({
  title,
  children,
  tone = "neutral",
  action,
  className = "",
}: {
  title: ReactNode;
  children?: ReactNode;
  tone?: StatusBannerTone;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      role="status"
      className={cx(
        "rounded-[var(--vl-radius-md)] border p-4 shadow-sm",
        STATUS_BANNER_CLASSES[tone],
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight tracking-normal">
            {title}
          </p>
          {children && (
            <div className="mt-1 text-sm leading-relaxed">{children}</div>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </section>
  );
}

// --- Buttons ----------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: PRIMARY_ACTION_CLASS,
  secondary: SECONDARY_ACTION_CLASS,
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-[var(--vl-accent)] transition hover:bg-[var(--vl-accent-soft)]",
};

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-sm",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-12 px-6 py-3 text-lg",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  style,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const buttonStyle: CSSProperties | undefined =
    variant === "primary"
      ? { background: "var(--brand-gradient, var(--brand-color))", ...style }
      : style;

  return (
    <button
      {...props}
      type={type}
      style={buttonStyle}
      className={cx(
        BUTTON_VARIANT_CLASSES[variant],
        BUTTON_SIZE_CLASSES[size],
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  href,
  variant = "primary",
  size = "md",
  className = "",
  style,
  disabled = false,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}) {
  const linkStyle: CSSProperties | undefined =
    variant === "primary"
      ? { background: "var(--brand-gradient, var(--brand-color))", ...style }
      : style;

  return (
    <Link
      {...props}
      href={disabled ? "#" : href}
      aria-disabled={disabled ? true : props["aria-disabled"]}
      tabIndex={disabled ? -1 : props.tabIndex}
      style={linkStyle}
      className={cx(
        BUTTON_VARIANT_CLASSES[variant],
        BUTTON_SIZE_CLASSES[size],
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {children}
    </Link>
  );
}

// --- Fields -----------------------------------------------------------------

export function Field({
  children,
  label,
  htmlFor,
  hint,
  error,
  className = "",
}: {
  children?: ReactNode;
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-semibold text-[var(--vl-text-primary)]"
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="text-sm text-[var(--vl-text-muted)]">{hint}</p>
      )}
      {error && (
        <p className="text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({ className = "", invalid = false, ...props }: InputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid ? true : props["aria-invalid"]}
      className={cx(
        "w-full rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface-elevated)] px-3 py-2 text-[length:var(--vl-type-workbench-body)] text-[var(--vl-text-primary)] shadow-sm transition duration-vl-fast ease-vl-standard placeholder:text-[var(--vl-text-muted)] focus:border-[var(--vl-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--vl-focus-ring)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500",
        invalid && "border-red-300 focus:border-red-500 focus:ring-red-200",
        className,
      )}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export function Select({
  children,
  className = "",
  invalid = false,
  ...props
}: SelectProps) {
  return (
    <select
      {...props}
      aria-invalid={invalid ? true : props["aria-invalid"]}
      className={cx(
        "w-full rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface-elevated)] px-3 py-2 text-[length:var(--vl-type-workbench-body)] text-[var(--vl-text-primary)] shadow-sm transition duration-vl-fast ease-vl-standard focus:border-[var(--vl-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--vl-focus-ring)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500",
        invalid && "border-red-300 focus:border-red-500 focus:ring-red-200",
        className,
      )}
    >
      {children}
    </select>
  );
}

// --- Language dropdown ------------------------------------------------------

export type LanguageDropdownLocale = "en" | "fr";
export type LanguageDropdownFormAction =
  | string
  | ((formData: FormData) => void | Promise<void>);

export const LANGUAGE_DROPDOWN_OPTIONS: ReadonlyArray<{
  value: LanguageDropdownLocale;
  label: string;
}> = [
  { value: "en", label: "EN" },
  { value: "fr", label: "FR" },
];

export function languageDropdownFormAction(
  setLocaleAction: (locale: string) => void | Promise<void>,
) {
  return async (formData: FormData) => {
    const locale = formData.get("locale");
    await setLocaleAction(typeof locale === "string" ? locale : "");
  };
}

export function LanguageDropdown({
  locale,
  action,
  label = "Language",
  submitLabel = "Apply",
  id = "language",
  pinned = false,
  size = "sm",
  className = "",
}: {
  locale: LanguageDropdownLocale;
  action: LanguageDropdownFormAction;
  label?: string;
  submitLabel?: string;
  id?: string;
  pinned?: boolean;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <form
      action={action}
      className={cx(
        "flex flex-wrap items-end gap-2",
        pinned &&
          "sticky top-4 z-20 rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface-elevated)] p-2 shadow-sm",
        className,
      )}
    >
      <Field label={label} htmlFor={id} className="min-w-28">
        <Select
          id={id}
          name="locale"
          defaultValue={locale}
          aria-label={label}
          className={size === "lg" ? "min-h-12 text-base" : undefined}
        >
          {LANGUAGE_DROPDOWN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" size={size}>
        {submitLabel}
      </Button>
    </form>
  );
}

// --- Back / next anchors ----------------------------------------------------

export function BackNext({
  backHref,
  nextHref,
  backLabel = "Back",
  nextLabel = "Next",
  ariaLabel = "Step navigation",
  className = "",
}: {
  backHref: string;
  nextHref: string;
  backLabel?: ReactNode;
  nextLabel?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cx(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-end justify-between gap-4 p-4 sm:p-6",
        className,
      )}
    >
      <Link
        href={backHref}
        className="pointer-events-auto inline-flex min-h-12 items-center justify-center rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface-elevated)] px-5 py-3 text-base font-semibold text-[var(--vl-text-secondary)] shadow-sm transition duration-vl-fast ease-vl-standard hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2"
      >
        {backLabel}
      </Link>
      <Link
        href={nextHref}
        className="pointer-events-auto inline-flex min-h-12 items-center justify-center rounded-[var(--vl-radius-md)] px-6 py-3 text-base font-semibold text-white shadow-sm transition duration-vl-fast ease-vl-standard hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vl-focus-ring)] focus-visible:ring-offset-2"
        style={{ background: "var(--brand-gradient, var(--brand-color))" }}
      >
        {nextLabel}
      </Link>
    </nav>
  );
}

// --- Workbench data table ---------------------------------------------------

export function DataTable({
  children,
  caption,
  className = "",
}: {
  children?: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "overflow-hidden rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface-elevated)] shadow-sm",
        className,
      )}
    >
      <table className="min-w-full border-collapse text-left text-[length:var(--vl-type-workbench-body)] text-[var(--vl-text-primary)]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function DataTableRow({
  children,
  className = "",
  interactive = false,
  selected = false,
}: {
  children?: ReactNode;
  className?: string;
  interactive?: boolean;
  selected?: boolean;
}) {
  return (
    <tr
      data-selected={selected ? "true" : undefined}
      className={cx(
        "border-b border-[var(--vl-border)] last:border-b-0",
        interactive &&
          "transition duration-vl-fast ease-vl-standard hover:bg-[var(--vl-accent-soft)] focus-within:bg-[var(--vl-accent-soft)]",
        selected && "bg-[var(--vl-accent-soft)]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function DataTableCell({
  children,
  as = "td",
  scope,
  numeric = false,
  muted = false,
  className = "",
}: {
  children?: ReactNode;
  as?: "td" | "th";
  scope?: "col" | "row";
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const classes = cx(
    "px-3 py-2 align-middle",
    as === "th" && "text-xs font-semibold uppercase tracking-wider",
    muted && "text-[var(--vl-text-muted)]",
    numeric && "text-right tabular-nums",
    className,
  );

  if (as === "th") {
    return (
      <th scope={scope ?? "col"} className={classes}>
        {children}
      </th>
    );
  }

  return <td className={classes}>{children}</td>;
}

export const Table = DataTable;
export const TableRow = DataTableRow;
export const TableCell = DataTableCell;
