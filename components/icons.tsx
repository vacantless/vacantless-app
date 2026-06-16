import type { SVGProps } from "react";

/**
 * Shared line-style icon set. One consistent visual language across the whole
 * app — the same rounded, 1.6-stroke marks used on the marketing homepage —
 * so the dashboard and the public renter page feel like the same product.
 *
 * Server-component friendly (pure SVG, no client state). Pass a `className`
 * (e.g. "h-5 w-5") to size; color is `currentColor` so the parent decides it
 * (white inside a brand IconTile, text-brand on a tinted chip, etc.).
 */

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
    ...props,
    className: props.className ?? "h-5 w-5",
  } as IconProps;
}

export const Icons = {
  home: (p: IconProps) => (
    <svg {...base(p)}>
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
  ),
  check: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="m5 12.5 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  bolt: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  link: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="M9.5 14.5 14.5 9.5M10 6.5l1.2-1.2a4 4 0 0 1 5.7 5.7L15.5 12M14 17.5l-1.2 1.2a4 4 0 0 1-5.7-5.7L8.5 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  page: (p: IconProps) => (
    <svg {...base(p)}>
      <rect
        x="5"
        y="3"
        width="14"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 8h6M9 12h6M9 16h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  list: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="M8 6h12M8 12h12M8 18h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="4" cy="6" r="1.3" fill="currentColor" />
      <circle cx="4" cy="12" r="1.3" fill="currentColor" />
      <circle cx="4" cy="18" r="1.3" fill="currentColor" />
    </svg>
  ),
  calendar: (p: IconProps) => (
    <svg {...base(p)}>
      <rect
        x="4"
        y="5"
        width="16"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4 9h16M8 3v4M16 3v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14" r="1.6" fill="currentColor" />
    </svg>
  ),
  clock: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.5V12l3 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  building: (p: IconProps) => (
    <svg {...base(p)}>
      <rect
        x="5"
        y="3"
        width="14"
        height="18"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  users: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.5 19a5.5 5.5 0 0 1 11 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  chat: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8 9.5h8M8 12.5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  chart: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="M4 20h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="6"
        y="11"
        width="3"
        height="6"
        rx="0.8"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="11"
        y="7"
        width="3"
        height="10"
        rx="0.8"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="16"
        y="13"
        width="3"
        height="4"
        rx="0.8"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  ),
  key: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m11 11 8 8m-3-3 2-2m-4 0 2-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  settings: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  card: (p: IconProps) => (
    <svg {...base(p)}>
      <rect
        x="3"
        y="5.5"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3 10h18M6.5 14.5h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  star: (p: IconProps) => (
    <svg {...base(p)}>
      <path
        d="M12 4.5l2.3 4.7 5.2.8-3.75 3.65.9 5.15L12 16.9l-4.65 2.45.9-5.15L4.5 10l5.2-.8L12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  mail: (p: IconProps) => (
    <svg {...base(p)}>
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m4.5 7 7.5 5.5L19.5 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
} as const;

export type IconName = keyof typeof Icons;
