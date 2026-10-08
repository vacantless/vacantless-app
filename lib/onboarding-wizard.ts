export type OnboardingWizardStepKey =
  | "property"
  | "viewing_times"
  | "get_online"
  | "tenancy"
  | "rent_rail";

export type OnboardingWizardStepStatus = "complete" | "current" | "todo";

export type OnboardingWizardStep = {
  key: OnboardingWizardStepKey;
  label: string;
  description: string;
  href: string;
  cta: string;
  status: OnboardingWizardStepStatus;
  optional?: boolean;
  canMarkHandled?: boolean;
};

export type OnboardingWizardState = {
  steps: OnboardingWizardStep[];
  completedCount: number;
  totalCount: number;
  nextIncompleteStep: OnboardingWizardStep | null;
  isComplete: boolean;
  isDismissed: boolean;
  shouldShowCard: boolean;
};

export type OnboardingWizardInput = {
  hasProperty: boolean;
  /**
   * At least one listing_posts row is `live` for this org: an ad exists on a
   * rental site. Object status, never a self-report (S691, the first-time
   * walk: the checklist had no "advertise it" step at all).
   */
  hasLiveListing: boolean;
  hasTenancy: boolean;
  /** DISTRIBUTION_WIZARD_ENABLED: the step links to the wizard when on, the Rentals list when dark (never a broken link). */
  wizardEnabled: boolean;
  railStepDoneAt: string | null;
  dismissedAt: string | null;
  /** S700: false drops the post-lease steps (tenancy, rent collection). Default true. */
  postLeaseEnabled?: boolean;
  /**
   * S702: the org has at least one weekly viewing window or custom date. When
   * the caller passes it, a "Set your viewing times" step sits between adding
   * the rental and posting it (a stranger could go live with nothing bookable).
   * Omitted = the step is not shown (back-compat for callers that do not query it).
   */
  hasViewingTimes?: boolean;
  /** ADD_PROPERTY_V2_ENABLED: "Add rental" opens the add page; the old #add-rental anchor is not rendered then (dress rehearsal F14). */
  addPropertyV2Enabled?: boolean;
};

type StepDef = Omit<OnboardingWizardStep, "status">;

const STEP_DEFS: StepDef[] = [
  {
    key: "property",
    label: "Add your first rental",
    description:
      "Create the rental record first. You can start with just the address and fill in the rest later.",
    href: "/dashboard/properties#add-rental",
    cta: "Add rental",
  },
  {
    key: "viewing_times",
    label: "Set your viewing times",
    description:
      "Pick the hours renters can book a viewing. Without them, renters can only send their details and wait for you to reach out.",
    href: "/dashboard/availability",
    cta: "Set viewing times",
  },
  {
    key: "get_online",
    label: "Put it on the rental sites",
    description:
      "Start with Facebook Marketplace (free) and Kijiji (one free ad per personal account). Paid sites come after. Done when one ad is live, or when the unit already has a tenant.",
    href: "/dashboard/properties",
    cta: "Post my rental",
  },
  {
    key: "tenancy",
    label: "Add a tenancy and tenant",
    description:
      "After you find a tenant: record the lease and the primary tenant when you are ready to collect rent or track tenant messages.",
    href: "/dashboard/tenancies/new",
    cta: "Add tenancy",
    optional: true,
  },
  {
    key: "rent_rail",
    label: "Set up rent collection",
    description:
      "After you find a tenant: connect Stripe or Rotessa in Banking, or mark this handled if you will collect rent another way for now.",
    href: "/dashboard/settings?tab=banking#stripe-rent",
    cta: "Open banking setup",
    optional: true,
    canMarkHandled: true,
  },
];

export function computeOnboardingState(
  input: OnboardingWizardInput,
): OnboardingWizardState {
  const done: Record<OnboardingWizardStepKey, boolean> = {
    property: input.hasProperty,
    viewing_times: input.hasViewingTimes === true,
    // A tenanted unit has nothing to advertise; do not resurrect the checklist
    // for every org that finished the old three steps (reviewer S691 #3).
    get_online: input.hasLiveListing || input.hasTenancy,
    tenancy: input.hasTenancy,
    rent_rail: Boolean(input.railStepDoneAt),
  };

  let currentAssigned = false;
  const defs = STEP_DEFS.filter((def) => {
    if (def.key === "viewing_times" && input.hasViewingTimes === undefined) return false;
    if (input.postLeaseEnabled === false && (def.key === "tenancy" || def.key === "rent_rail")) {
      return false;
    }
    return true;
  });
  const steps = defs.map((def) => {
    let status: OnboardingWizardStepStatus;
    if (done[def.key]) {
      status = "complete";
    } else if (!currentAssigned) {
      status = "current";
      currentAssigned = true;
    } else {
      status = "todo";
    }
    if (def.key === "property" && input.addPropertyV2Enabled) {
      return { ...def, href: "/dashboard/properties/new", status };
    }
    if (def.key === "get_online" && input.wizardEnabled) {
      return { ...def, href: "/dashboard/link-portals", status };
    }
    return { ...def, status };
  });

  const completedCount = steps.filter((step) => step.status === "complete").length;
  const isComplete = completedCount === steps.length;
  const isDismissed = Boolean(input.dismissedAt);

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    nextIncompleteStep: steps.find((step) => step.status === "current") ?? null,
    isComplete,
    isDismissed,
    shouldShowCard: !isDismissed && !isComplete,
  };
}
