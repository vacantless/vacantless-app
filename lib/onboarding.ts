/**
 * Pure logic for the Overview launch checklist + "next best action".
 *
 * No DB or env access — the Overview server page fetches the signals (counts
 * + the org row) and passes them in, so this stays unit-testable. Each step
 * maps to a concrete, observable signal; the first incomplete step is marked
 * "current" and becomes the next-best-action the dashboard highlights.
 *
 * Run tests: npx tsx scripts/test-onboarding.ts
 */

// Re-exported from the single source of truth so existing importers of
// `@/lib/onboarding` (and its test) keep working.
import { DEFAULT_BRAND_COLOR } from "./brand-theme";
export { DEFAULT_BRAND_COLOR };

export type ChecklistStatus = "complete" | "current" | "todo";

export type ChecklistStep = {
  key: string;
  label: string;
  description: string;
  href: string;
  cta: string;
  status: ChecklistStatus;
  /** When true the UI should open href in a new tab (e.g. a public /r page). */
  newTab?: boolean;
};

export type LaunchChecklist = {
  steps: ChecklistStep[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  /** First non-complete step — the next best action. Null once all complete. */
  nextStep: ChecklistStep | null;
};

export type ChecklistInput = {
  propertyCount: number;
  availabilityWindowCount: number;
  brandingConfirmed: boolean;
  leadCount: number;
  subscriptionActive: boolean;
  /**
   * Id of a property to deep-link the "Test your renter intake page" step to.
   * When set, that step points straight at the property's public `/r/[id]`
   * page (opened in a new tab) instead of the Properties list, turning the
   * step into a single click.
   *
   * MUST be a PUBLICLY-VISIBLE property — the caller passes the most-recent
   * AVAILABLE property, because the public `/r` page 404s on draft/off-market
   * (get_public_listing excludes them). Passing the newest property of ANY
   * status would point the step at a draft and 404 (the S294 preview-broken
   * bug). Null/undefined until a live property exists → the step keeps its
   * default Properties-list href.
   */
  firstPropertyId?: string | null;
};

/**
 * Heuristic: the org has "confirmed branding" once it has customized any brand
 * field away from the defaults — a logo, a reply-to, or a non-default color.
 * Name alone doesn't count (it's set at onboarding), so it isn't a signal that
 * the owner has visited Settings.
 */
export function isBrandingConfirmed(org: {
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
}): boolean {
  const color = (org.brand_color ?? "").trim().toLowerCase();
  const customColor = color !== "" && color !== DEFAULT_BRAND_COLOR;
  return Boolean(org.logo_url) || Boolean(org.reply_to_email) || customColor;
}

type StepDef = Omit<ChecklistStep, "status">;

const STEP_DEFS: StepDef[] = [
  {
    key: "property",
    label: "Add your first rental",
    description:
      "Create a listing so you have a public inquiry page renters can find.",
    href: "/dashboard/properties",
    cta: "Add rental",
  },
  {
    key: "availability",
    label: "Set viewing availability",
    description:
      "Add weekly windows so renters can self-book viewings around your schedule.",
    href: "/dashboard/availability",
    cta: "Set availability",
  },
  {
    key: "branding",
    label: "Confirm your branding",
    description:
      "Set your business name, brand color, logo, and reply-to so renter emails look like you.",
    href: "/dashboard/settings",
    cta: "Open settings",
  },
  {
    key: "intake",
    label: "Test your renter inquiry page",
    description:
      "Submit a test inquiry on a rental's public link to see the full inquiry-to-lease flow.",
    href: "/dashboard/properties",
    cta: "Open a rental",
  },
  {
    key: "golive",
    label: "Go live",
    description:
      "Start a 30-day pilot or subscribe to a plan when you're ready to run real listings on Vacantless.",
    href: "/dashboard/billing",
    cta: "View billing",
  },
];

/**
 * Build the checklist with a status per step. Steps are independent signals,
 * but exactly one incomplete step (the first) is flagged "current" so the UI
 * can highlight a single next action; later incomplete steps are "todo".
 */
export function buildLaunchChecklist(input: ChecklistInput): LaunchChecklist {
  const done: boolean[] = [
    input.propertyCount > 0,
    input.availabilityWindowCount > 0,
    input.brandingConfirmed,
    input.leadCount > 0,
    input.subscriptionActive,
  ];

  let currentAssigned = false;
  const steps: ChecklistStep[] = STEP_DEFS.map((def, i) => {
    let status: ChecklistStatus;
    if (done[i]) {
      status = "complete";
    } else if (!currentAssigned) {
      status = "current";
      currentAssigned = true;
    } else {
      status = "todo";
    }

    // Once a property exists, the "intake" step deep-links straight to that
    // property's public renter page so testing it is one click, not a hunt.
    if (def.key === "intake" && input.firstPropertyId) {
      return {
        ...def,
        href: `/r/${input.firstPropertyId}`,
        cta: "Preview inquiry page",
        newTab: true,
        status,
      };
    }

    return { ...def, status };
  });

  const completedCount = done.filter(Boolean).length;
  const nextStep = steps.find((s) => s.status === "current") ?? null;

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    allComplete: completedCount === steps.length,
    nextStep,
  };
}
