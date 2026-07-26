import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand-color, #17362f)",
        },
        presentation: {
          surface: "var(--vl-surface)",
          elevated: "var(--vl-surface-elevated)",
          border: "var(--vl-border)",
          accent: "var(--vl-accent)",
          focus: "var(--vl-focus-ring)",
          text: {
            primary: "var(--vl-text-primary)",
            secondary: "var(--vl-text-secondary)",
            muted: "var(--vl-text-muted)",
          },
          status: {
            success: {
              DEFAULT: "var(--vl-status-success-bg)",
              border: "var(--vl-status-success-border)",
              text: "var(--vl-status-success-text)",
              solid: "var(--vl-status-success-solid)",
              on: "var(--vl-status-success-on)",
            },
            attention: {
              DEFAULT: "var(--vl-status-attention-bg)",
              border: "var(--vl-status-attention-border)",
              text: "var(--vl-status-attention-text)",
              solid: "var(--vl-status-attention-solid)",
              on: "var(--vl-status-attention-on)",
            },
            neutral: {
              DEFAULT: "var(--vl-status-neutral-bg)",
              border: "var(--vl-status-neutral-border)",
              text: "var(--vl-status-neutral-text)",
              solid: "var(--vl-status-neutral-solid)",
              on: "var(--vl-status-neutral-on)",
            },
            info: {
              DEFAULT: "var(--vl-status-info-bg)",
              border: "var(--vl-status-info-border)",
              text: "var(--vl-status-info-text)",
              solid: "var(--vl-status-info-solid)",
              on: "var(--vl-status-info-on)",
            },
          },
        },
      },
      fontSize: {
        "vl-display": [
          "2.75rem",
          { lineHeight: "1.05", fontWeight: "700" },
        ],
        "vl-h1": ["2rem", { lineHeight: "1.15", fontWeight: "700" }],
        "vl-h2": ["1.375rem", { lineHeight: "1.25", fontWeight: "650" }],
        "vl-guided-body": ["1.1875rem", { lineHeight: "1.6" }],
        "vl-workbench-body": ["0.9375rem", { lineHeight: "1.55" }],
        "vl-small": ["0.8125rem", { lineHeight: "1.45" }],
      },
      spacing: {
        "vl-guided": "1.5rem",
        "vl-workbench": "1rem",
      },
      borderRadius: {
        "vl-sm": "var(--vl-radius-sm)",
        "vl-md": "var(--vl-radius-md)",
        "vl-lg": "var(--vl-radius-lg)",
      },
      boxShadow: {
        "vl-elevated": "var(--vl-shadow-elevated)",
        "vl-focus": "var(--vl-focus-shadow)",
      },
      transitionDuration: {
        "vl-fast": "var(--vl-motion-duration-fast)",
        "vl-base": "var(--vl-motion-duration-base)",
      },
      transitionTimingFunction: {
        "vl-standard": "var(--vl-motion-ease)",
      },
    },
  },
  plugins: [],
};

export default config;
