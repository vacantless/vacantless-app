export type OnboardingWizardStepKey = "property" | "tenancy" | "rent_rail";

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
  hasTenancy: boolean;
  railStepDoneAt: string | null;
  dismissedAt: string | null;
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
    key: "tenancy",
    label: "Add a tenancy and tenant",
    description:
      "Record the lease and the primary tenant when you are ready to collect rent or track tenant messages.",
    href: "/dashboard/tenancies/new",
    cta: "Add tenancy",
    optional: true,
  },
  {
    key: "rent_rail",
    label: "Set up rent collection",
    description:
      "Connect Stripe or Rotessa in Banking, or mark this handled if you will collect rent another way for now.",
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
    tenancy: input.hasTenancy,
    rent_rail: Boolean(input.railStepDoneAt),
  };

  let currentAssigned = false;
  const steps = STEP_DEFS.map((def) => {
    let status: OnboardingWizardStepStatus;
    if (done[def.key]) {
      status = "complete";
    } else if (!currentAssigned) {
      status = "current";
      currentAssigned = true;
    } else {
      status = "todo";
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
