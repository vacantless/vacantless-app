/**
 * Vacantless V-check mark — the locked brand logo (a V with an embedded
 * checkmark = "vacancy filled / approved").
 *
 * Two-tier rule (multi-tenant safe — the mark is MONOCHROME so it never
 * clashes with a tenant's `--brand-color`):
 *   - "black"    flat-black functional mark — app chrome, nav, small sizes,
 *                and ANYWHERE a tenant colour is on screen.
 *   - "white"    reversed white V + dark check — for dark / colour-filled
 *                surfaces (e.g. the tenant-gradient dashboard header).
 *   - "gradient" indigo->teal marketing gradient (#4F46E5->#2563EB->#14B8A6)
 *                — LARGE marketing moments only (hero, social, decks). Never
 *                below nav-bar height: the gradient muddies and the thin white
 *                check vanishes at small sizes. Render at most ONE per page.
 *
 * Purely presentational, no hooks, so it renders from both server and client
 * components. Paths mirror /vacantless-brand-assets/source/*.svg.
 */

type Variant = "black" | "white" | "gradient";

const V_BODY =
  "M91.7 74h72.4c13.3 0 25.1 8.3 29.6 20.8l63.6 178.5 63.7-178.5c4.5-12.5 16.3-20.8 29.6-20.8h70.1c22.8 0 38.1 23.4 29 44.3L292.1 424.1c-13.6 31.4-58.2 31.5-71.9.1L62.8 118.2C53.5 97.3 68.8 74 91.7 74Z";
const CHECK =
  "M233.8 356.4c-6.3 0-12.3-2.7-16.5-7.4l-54.1-61.5c-8.1-9.2-7.2-23.2 2-31.3 9.2-8.1 23.2-7.2 31.3 2l36.3 41.3 89.6-111.7c7.7-9.6 21.7-11.1 31.2-3.4 9.6 7.7 11.1 21.7 3.4 31.2L251.1 348c-4 5-10 8-16.4 8.3-.3.1-.6.1-.9.1Z";

export function VacantlessMark({
  variant = "black",
  className = "h-7 w-7",
  title = "Vacantless",
  gradientId = "vacantlessMarkGradient",
}: {
  variant?: Variant;
  className?: string;
  title?: string;
  /** Override only if rendering more than one gradient mark on a page. */
  gradientId?: string;
}) {
  const bodyFill =
    variant === "gradient"
      ? `url(#${gradientId})`
      : variant === "white"
        ? "#FFFFFF"
        : "#0B0B0B";
  const checkFill = variant === "white" ? "#0B0B0B" : "#FFFFFF";

  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label={title}
    >
      {variant === "gradient" ? (
        <defs>
          <linearGradient
            id={gradientId}
            x1="66"
            y1="78"
            x2="442"
            y2="418"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#4F46E5" />
            <stop offset="52%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
      ) : null}
      <path fill={bodyFill} d={V_BODY} />
      <path fill={checkFill} d={CHECK} />
    </svg>
  );
}
