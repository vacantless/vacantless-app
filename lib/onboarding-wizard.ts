export type OnboardingWizardStepKey =
  | "property"
  | "viewing_times"
  | "connect_sites"
  | "renter_emails"
  | "get_online"
  | "see_it_work"
  | "phone_replies"
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
  /**
   * S821b: "start" is the short path to a first ad (rental, viewing times,
   * one site, Set Live). "later" is everything a new landlord can leave until
   * a renter has written. Nine steps at once read as too much.
   */
  group: OnboardingWizardStepGroup;
};

export type OnboardingWizardStepGroup = "start" | "later";

export type OnboardingWizardState = {
  steps: OnboardingWizardStep[];
  /** S821b: the "Start here" steps only. */
  startDoneCount: number;
  startTotalCount: number;
  startComplete: boolean;
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
  /**
   * S734 (review item 1): the rental to post, when the org has one. The
   * "Post my rental" step then opens that rental's sites view, where the
   * free sites and the one-click Facebook Page post are, instead of the
   * "Sign in to your rental sites" page that led with three locked tiles.
   */
  postRentalPropertyId?: string | null;
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
  /**
   * S760: the org has connected at least one rental site (Facebook Page
   * linked, or a robot site signed in; lib/sites-setup orgHasConnectedSite).
   * When the caller passes it, a "Connect your rental sites" step sits before
   * "Set it live", so a stranger connects once and every later rental posts on
   * Set Live. Omitted = the step is not shown (back-compat).
   */
  hasConnectedSite?: boolean;
  /**
   * S806 (REVIEW-S805 finding 7): a renter email from Kijiji, Rentals.ca or
   * Zumper has reached Vacantless at least once (lib/renter-emails). When the
   * caller passes it (accounts that post to those sites), a "Get renter emails
   * here" step follows "Connect your rental sites". Omitted = not shown.
   */
  hasRenterEmails?: boolean;
  /**
   * S770 (REVIEW-S770 section 3 item 4): the org has at least one renter.
   * When the caller passes it, a "See it work" step follows Set Live: open the
   * rental page, send yourself an inquiry, watch the reply and the viewing
   * land on Today. Omitted = the step is not shown (back-compat).
   */
  hasLead?: boolean;
  /** The live rental's public page for that step (/r/<id>); null before Set Live. */
  liveRentalId?: string | null;
  /**
   * S817d: a renter was saved from the phone, by the Send to Vacantless
   * Shortcut or by Quick replies' Copy (lib/reply-kit-server
   * hasPhoneReplyRenter). When the caller passes it, an "Answer renters from
   * your phone" step follows "See it work". Omitted = not shown.
   */
  hasPhoneReplies?: boolean;
};

type StepDef = Omit<OnboardingWizardStep, "status">;

const STEP_DEFS: StepDef[] = [
  {
    key: "property",
    group: "start",
    label: "Add your first rental",
    description:
      "Start with the address, rent, beds and baths. You can add photos and the rest later.",
    href: "/dashboard/properties#add-rental",
    cta: "Add rental",
  },
  {
    key: "viewing_times",
    group: "start",
    label: "Set your viewing times",
    description:
      "Pick the hours renters can book a viewing. Without them, renters can only send their details and wait for you to reach out.",
    href: "/dashboard/availability",
    cta: "Set viewing times",
  },
  {
    key: "connect_sites",
    group: "start",
    label: "Connect your rental sites",
    description:
      "One site is enough to start. You can add the others later. Connect your Facebook Page, install the helper for Marketplace, or sign in to Kijiji, Rentals.ca or Zumper. After this, Set Live posts each rental on every connected site. If a site signs you out, we tell you.",
    href: "/dashboard/sites?from=getting-started",
    cta: "Connect sites",
  },
  {
    key: "renter_emails",
    group: "start",
    label: "Get renter emails here",
    description:
      "Kijiji, Rentals.ca and Zumper email you when a renter writes. Send those emails to your Vacantless address once. Each renter then lands on Today and gets your booking link. Done when the first one comes in.",
    href: "/dashboard/sites?from=getting-started#renter-emails",
    cta: "Set it up",
  },
  {
    key: "get_online",
    group: "start",
    label: "Set your rental live",
    description:
      "Press Set Live on your rental. We post it to every site you connected and keep the ads up. Done when one ad is live.",
    href: "/dashboard/properties",
    cta: "Post my rental",
  },
  {
    key: "see_it_work",
    group: "later",
    label: "See it work",
    description:
      "Open your rental page and send yourself an inquiry. The reply with your booking link arrives in seconds. The renter lands on Today. Done when your first renter is in the list.",
    href: "/dashboard/properties",
    cta: "Open my rental page",
  },
  {
    key: "phone_replies",
    group: "later",
    label: "Answer renters from your phone",
    description:
      "Renters on Facebook write in Messenger, mostly on your phone. Open Quick replies on your phone and add it to your home screen. On iPhone, also add the Send to Vacantless Shortcut. On Android, installing the app is enough. Share a chat screenshot, and it saves the renter and gives you your reply. Done when your first renter is saved this way.",
    href: "/dashboard/replies?from=getting-started#send-shortcut",
    cta: "Set up my phone",
  },
  {
    key: "tenancy",
    group: "later",
    label: "Add a tenancy and tenant",
    description:
      "After you find a tenant: record the lease and the primary tenant when you are ready to collect rent or track tenant messages.",
    href: "/dashboard/tenancies/new",
    cta: "Add tenancy",
    optional: true,
  },
  {
    key: "rent_rail",
    group: "later",
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
    connect_sites: input.hasConnectedSite === true || input.hasLiveListing || input.hasTenancy,
    renter_emails: input.hasRenterEmails === true || input.hasTenancy,
    // A tenanted unit has nothing to advertise; do not resurrect the checklist
    // for every org that finished the old three steps (reviewer S691 #3).
    get_online: input.hasLiveListing || input.hasTenancy,
    see_it_work: input.hasLead === true || input.hasTenancy,
    phone_replies: input.hasPhoneReplies === true || input.hasTenancy,
    tenancy: input.hasTenancy,
    rent_rail: Boolean(input.railStepDoneAt),
  };

  let currentAssigned = false;
  const defs = STEP_DEFS.filter((def) => {
    if (def.key === "viewing_times" && input.hasViewingTimes === undefined) return false;
    if (def.key === "connect_sites" && input.hasConnectedSite === undefined) return false;
    if (def.key === "renter_emails" && input.hasRenterEmails === undefined) return false;
    if (def.key === "see_it_work" && input.hasLead === undefined) return false;
    if (def.key === "phone_replies" && input.hasPhoneReplies === undefined) return false;
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
    if (def.key === "get_online" && input.postRentalPropertyId) {
      return {
        ...def,
        href: `/dashboard/properties/${encodeURIComponent(input.postRentalPropertyId)}?tab=distribute#distribute-header`,
        status,
      };
    }
    if (def.key === "see_it_work" && input.liveRentalId) {
      return { ...def, href: `/r/${encodeURIComponent(input.liveRentalId)}`, status };
    }
    if (def.key === "get_online" && input.wizardEnabled) {
      return { ...def, href: "/dashboard/sites", status };
    }
    return { ...def, status };
  });

  const completedCount = steps.filter((step) => step.status === "complete").length;
  const isComplete = completedCount === steps.length;
  const isDismissed = Boolean(input.dismissedAt);

  const startSteps = steps.filter((step) => step.group === "start");
  const startDoneCount = startSteps.filter((step) => step.status === "complete").length;

  return {
    steps,
    startDoneCount,
    startTotalCount: startSteps.length,
    startComplete: startDoneCount === startSteps.length,
    completedCount,
    totalCount: steps.length,
    nextIncompleteStep: steps.find((step) => step.status === "current") ?? null,
    isComplete,
    isDismissed,
    shouldShowCard: !isDismissed && !isComplete,
  };
}
