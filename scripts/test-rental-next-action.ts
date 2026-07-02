// Unit tests for the rental lifecycle forward-derivation (IA Step 4 slice 3, S279).
// Run: npx tsx scripts/test-rental-next-action.ts
import {
  deriveNextAction,
  type NextActionInput,
  type NextActionPolicy,
} from "../lib/rental-next-action";
import { type LifecycleStep } from "../lib/rental-lifecycle";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const PID = "11111111-1111-1111-1111-111111111111";

const emptyPolicy: NextActionPolicy = {
  lease_term: null,
  smoking: null,
  ac_type: null,
  on_site_management: null,
  heat_included: null,
  hydro_included: null,
  water_included: null,
  pets_cats: null,
  pets_dogs: null,
};

function inp(over: Partial<NextActionInput> = {}): NextActionInput {
  return {
    propertyId: PID,
    currentStep: "set_up",
    hasRent: false,
    bedsSet: false,
    bathsSet: false,
    effective: emptyPolicy,
    inherited: new Set<string>(),
    isLive: false,
    photoCount: 0,
    channelCount: 0,
    linkIsLive: false,
    listingPostCount: 0,
    hasAvailability: false,
    openInquiryCount: 0,
    applicantCount: 0,
    ...over,
  };
}

function findGap(a: ReturnType<typeof deriveNextAction>, key: string): boolean {
  return !!a && a.gaps.some((g) => g.key === key);
}
function findFact(a: ReturnType<typeof deriveNextAction>, key: string) {
  return a ? a.derived.find((f) => f.key === key) : undefined;
}

// --- tenanted / null --------------------------------------------------------
ok("null current step -> null action", deriveNextAction(inp({ currentStep: null })) === null);

// --- set up: gaps -----------------------------------------------------------
{
  const a = deriveNextAction(inp({ currentStep: "set_up" }));
  ok("set_up returns an action", a !== null);
  ok("set_up step is set_up", a?.step === "set_up");
  ok("set_up always has a rent gap", findGap(a, "rent"));
  ok("set_up: beds gap when unset", findGap(a, "beds"));
  ok("set_up: baths gap when unset", findGap(a, "baths"));
  ok("set_up cta -> #rental-details", a?.cta.href === `/dashboard/properties/${PID}#rental-details`);
}
{
  // rent still missing (hasRent defaults false) but beds/baths set -> rent gap is the outstanding one
  const a = deriveNextAction(inp({ currentStep: "set_up", bedsSet: true, bathsSet: true }));
  ok("set_up: no beds gap when set", !findGap(a, "beds"));
  ok("set_up: no baths gap when set", !findGap(a, "baths"));
  ok("set_up: rent gap remains when rent missing", findGap(a, "rent"));
}
{
  // rent PRESENT but beds/baths missing -> no rent gap, only the missing ones (S400 Codex P3)
  const a = deriveNextAction(inp({ currentStep: "set_up", hasRent: true }));
  ok("set_up: no rent gap when rent already set", !findGap(a, "rent"));
  ok("set_up: beds gap when unset (rent present)", findGap(a, "beds"));
  ok("set_up: baths gap when unset (rent present)", findGap(a, "baths"));
}

// --- set up: the cascade (inherited policy facts) ---------------------------
{
  const effective: NextActionPolicy = {
    lease_term: "1_year",
    smoking: "non_smoking",
    ac_type: "central",
    on_site_management: true,
    heat_included: true,
    hydro_included: false,
    water_included: true,
    pets_cats: true,
    pets_dogs: false,
  };
  const inherited = new Set(["lease_term", "smoking", "ac_type", "on_site_management"]);
  const a = deriveNextAction(inp({ currentStep: "set_up", effective, inherited }));
  ok("set_up: lease_term fact present", !!findFact(a, "lease_term"));
  ok("set_up: lease_term marked inherited", findFact(a, "lease_term")?.inherited === true);
  ok("set_up: lease_term value formatted", findFact(a, "lease_term")?.value === "1-year lease");
  ok("set_up: smoking inherited + labeled", findFact(a, "smoking")?.inherited === true);
  ok("set_up: ac fact present", !!findFact(a, "ac_type"));
  ok("set_up: heat fact = Included", findFact(a, "heat_included")?.value === "Included");
  ok("set_up: hydro fact = Tenant pays", findFact(a, "hydro_included")?.value === "Tenant pays");
  ok("set_up: utilities not flagged inherited (no provenance)", findFact(a, "heat_included")?.inherited === false);
  ok("set_up: pets fact present + cats only", findFact(a, "pets")?.value === "Cats welcome");
  ok("set_up: blurb names inherited count", /already filled from your building defaults/.test(a?.blurb ?? ""));
}
{
  // no inherited fields -> the "set defaults once" educational blurb
  const a = deriveNextAction(inp({ currentStep: "set_up" }));
  ok("set_up: empty policy -> no derived facts", (a?.derived.length ?? -1) === 0);
  ok("set_up: empty policy -> education blurb", /inherit them automatically/.test(a?.blurb ?? ""));
}

// --- market -----------------------------------------------------------------
{
  const a = deriveNextAction(inp({ currentStep: "market", hasRent: true, photoCount: 0, isLive: false, channelCount: 5 }));
  ok("market: photos gap when 0 photos", findGap(a, "photos"));
  ok("market: live gap when not live", findGap(a, "live"));
  ok("market: copy fact reflects channels", findFact(a, "copy")?.value === "Written for 5 channels");
  ok("market: cta -> photos when no photos", a?.cta.href === `/dashboard/properties/${PID}#property-photos`);
}
{
  const a = deriveNextAction(inp({ currentStep: "market", hasRent: true, photoCount: 4, isLive: false, channelCount: 5 }));
  ok("market: no photos gap when photos present", !findGap(a, "photos"));
  ok("market: live gap still present", findGap(a, "live"));
  ok("market: cta -> rental-details (set live) when photos present", a?.cta.href === `/dashboard/properties/${PID}#rental-details`);
}
{
  const inherited = new Set(["lease_term", "smoking"]);
  const effective: NextActionPolicy = { ...emptyPolicy, lease_term: "1_year", smoking: "non_smoking" };
  const a = deriveNextAction(inp({ currentStep: "market", hasRent: true, photoCount: 2, isLive: true, channelCount: 5, effective, inherited }));
  ok("market: policy fact appears when inherited", findFact(a, "policy")?.inherited === true);
  ok("market: no gaps when live + photos", (a?.gaps.length ?? -1) === 0);
}

// --- inquiries --------------------------------------------------------------
{
  const a = deriveNextAction(inp({ currentStep: "inquiries", hasRent: true, isLive: true, linkIsLive: true, photoCount: 2, listingPostCount: 0 }));
  ok("inquiries: link fact present when live", !!findFact(a, "link"));
  ok("inquiries: share gap present", findGap(a, "share"));
  ok("inquiries: cta -> #share", a?.cta.href === `/dashboard/properties/${PID}#share`);
}
{
  const a = deriveNextAction(inp({ currentStep: "inquiries", linkIsLive: true, listingPostCount: 3 }));
  ok("inquiries: posts fact reflects count", findFact(a, "posts")?.value === "3 channels");
}

// --- viewings ---------------------------------------------------------------
{
  const a = deriveNextAction(inp({ currentStep: "viewings", hasAvailability: false }));
  ok("viewings: availability gap when no windows", findGap(a, "availability"));
  ok("viewings: cta -> availability when no windows", a?.cta.href === "/dashboard/availability");
}
{
  const a = deriveNextAction(inp({ currentStep: "viewings", hasAvailability: true, openInquiryCount: 2 }));
  ok("viewings: availability fact when set", !!findFact(a, "availability"));
  ok("viewings: book gap when open inquiries", findGap(a, "book"));
  ok("viewings: cta -> showings when windows set", a?.cta.href === "/dashboard/showings");
}

// --- screen -----------------------------------------------------------------
{
  const a = deriveNextAction(inp({ currentStep: "screen", applicantCount: 2 }));
  ok("screen: review gap when applications in", findGap(a, "review"));
  ok("screen: blurb counts applications", /2 applications are in/.test(a?.blurb ?? ""));
  ok("screen: cta -> screening", a?.cta.href === "/dashboard/leasing/screening");
}
{
  const a = deriveNextAction(inp({ currentStep: "screen", applicantCount: 0 }));
  ok("screen: no review gap when none in", !findGap(a, "review"));
}

// --- lease ------------------------------------------------------------------
{
  const effective: NextActionPolicy = { ...emptyPolicy, lease_term: "1_year" };
  const a = deriveNextAction(inp({ currentStep: "lease", effective, inherited: new Set(["lease_term"]) }));
  ok("lease: lease gap present", findGap(a, "lease"));
  ok("lease: policy fact present", !!findFact(a, "policy"));
  ok("lease: cta -> new tenancy for this unit", a?.cta.href === `/dashboard/tenancies/new?property=${PID}`);
}

// --- every non-null step yields a non-empty cta + title ---------------------
{
  const steps: LifecycleStep[] = ["set_up", "market", "inquiries", "viewings", "screen", "lease", "tenanted"];
  const allHaveCta = steps.every((s) => {
    const a = deriveNextAction(inp({ currentStep: s, hasRent: true }));
    return !!a && a.title.length > 0 && a.cta.label.length > 0 && a.cta.href.length > 0;
  });
  ok("every step -> title + cta", allHaveCta);
}

console.log(`\ntest-rental-next-action: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
