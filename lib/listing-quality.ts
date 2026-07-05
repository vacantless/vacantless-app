// ============================================================================
// Pure listing-quality layer (S412 Slice 5). No DOM / env / IO / LLM —
// unit-tested (scripts/test-listing-quality.ts).
//
// Three honest, deterministic checks that a small operator would otherwise pay
// a marketer for:
//   1. scoreListing()   — a strength score + what's weak/missing.
//   2. fairHousingLint() — flags wording that risks the Ontario Human Rights
//      Code (protected grounds in rental ads). This is guidance, not legal
//      advice, and errs toward flagging.
//   3. missingDetails() — persuasive details filters can't capture that a strong
//      ad usually mentions (light, layout, transit, ...).
//
// NOTE (scope): the LLM-dependent pieces from the plan — freeform semantic
// rewrite and a learned quality model — are deliberately NOT here. Per-portal
// rewrite already exists (lib/listing-copy); this ships the rule-based core with
// no model/cost dependency. House rule: hyphens not em dashes.
// ============================================================================

// --- 1. strength score -----------------------------------------------------
export type QualityCheck = {
  key: string;
  label: string;
  ok: boolean;
  weight: number; // contribution to the 100-point score
  hint: string;
};

export type ListingQuality = {
  score: number; // 0..100
  grade: "strong" | "fair" | "thin";
  checks: QualityCheck[];
  passed: number;
  total: number;
};

export type QualityInput = {
  description: string | null;
  photoCount: number;
  beds: number | null;
  baths: number | null;
  rentCents: number | null;
  hasFeatures: boolean; // any structured amenities/policy set
};

function words(text: string | null): number {
  if (!text) return 0;
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function scoreListing(input: QualityInput): ListingQuality {
  const descWords = words(input.description);
  const checks: QualityCheck[] = [
    {
      key: "photos",
      label: "Has photos",
      ok: input.photoCount >= 3,
      weight: 30,
      hint: "Add at least 3 photos - listings with photos get far more inquiries.",
    },
    {
      key: "description_length",
      label: "Description has real detail",
      ok: descWords >= 40,
      weight: 25,
      hint: "Write at least a short paragraph - a few sentences on layout, light, and what's nearby.",
    },
    {
      key: "rent",
      label: "Rent is set",
      ok: typeof input.rentCents === "number" && input.rentCents > 0,
      weight: 15,
      hint: "Set the monthly rent - it's the first thing renters filter on.",
    },
    {
      key: "beds_baths",
      label: "Beds and baths set",
      ok:
        input.beds != null &&
        Number.isFinite(input.beds) &&
        input.baths != null &&
        Number.isFinite(input.baths),
      weight: 15,
      hint: "Add the bed and bath count.",
    },
    {
      key: "features",
      label: "Amenities / policies filled in",
      ok: input.hasFeatures,
      weight: 15,
      hint: "Fill in amenities and policies (laundry, parking, pets) so filters can match you.",
    },
  ];

  const score = checks.reduce((n, c) => n + (c.ok ? c.weight : 0), 0);
  const grade: ListingQuality["grade"] =
    score >= 80 ? "strong" : score >= 50 ? "fair" : "thin";
  return {
    score,
    grade,
    checks,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
  };
}

export function gradeLabel(grade: unknown): string {
  return grade === "strong"
    ? "Strong"
    : grade === "fair"
      ? "Fair"
      : "Needs work";
}

// --- 2. fair-housing wording lint ------------------------------------------
// Each rule: a regex over the lowercased ad text + the protected ground it
// risks. Guidance only. Kept conservative and specific to avoid false alarms
// (e.g. "no pets" is NOT flagged - that's a lease-clause matter, not a Code
// ground).
type FairHousingRule = {
  key: string;
  pattern: RegExp;
  ground: string;
  message: string;
};

const FAIR_HOUSING_RULES: FairHousingRule[] = [
  {
    key: "no_children",
    pattern: /\bno (kids|children)\b|\bchild(ren)? not\b|\bnot suitable for (kids|children|families)\b/,
    ground: "family status",
    message:
      "Avoid excluding children or families - family status is protected. Describe the unit, not who can't live there.",
  },
  {
    key: "adults_only",
    pattern: /\badults? only\b|\badult (building|only)\b|\bmature (adults|tenants?) only\b/,
    ground: "age / family status",
    message:
      "\"Adults only\" risks age + family-status discrimination. Drop it unless the building is a legally designated seniors' residence.",
  },
  {
    key: "students",
    pattern: /\bno students\b|\bstudents? need not\b/,
    ground: "age",
    message: "Excluding students can signal age discrimination. Screen on income and references instead.",
  },
  {
    key: "employment",
    pattern: /\b(must be |only )?employed only\b|\bno (unemployed|students or unemployed)\b|\bworking professionals? only\b|\byoung professionals? only\b/,
    ground: "age / receipt of public assistance",
    message: "Requiring employment or \"professionals only\" can exclude protected groups. Assess ability to pay, not job status.",
  },
  {
    key: "public_assistance",
    pattern: /\bno (dss|welfare|odsp|ow\b|social assistance|public assistance|subsidy|subsidies)\b/,
    ground: "receipt of public assistance",
    message: "Receipt of public assistance is protected in Ontario - you cannot refuse tenants on that basis.",
  },
  {
    key: "religion",
    pattern: /\b(christian|muslim|jewish|hindu|catholic|religious)\s+(preferred|only|tenants?|household)\b/,
    ground: "creed",
    message: "Don't state a religious preference - creed is protected.",
  },
  {
    key: "sex",
    pattern: /\b(female|male|women|men|girls|boys)\s+only\b/,
    ground: "sex",
    message: "Restricting by sex is only allowed for genuinely shared living space. In a self-contained unit, drop it.",
  },
  {
    key: "marital_family",
    pattern: /\b(single|couple|married)s?\s+only\b|\bno (single|families|roommates)\b/,
    ground: "marital / family status",
    message: "Marital and family status are protected - don't restrict by household type.",
  },
  {
    key: "language_origin",
    pattern: /\b(must speak|english speaking|no immigrants|canadian(s)? only)\b/,
    ground: "place of origin / ethnic origin",
    message: "Language or origin requirements risk discrimination on place/ethnic origin.",
  },
];

export type FairHousingFlag = {
  key: string;
  ground: string;
  message: string;
};

export function fairHousingLint(description: string | null): FairHousingFlag[] {
  if (!description) return [];
  const text = description.toLowerCase();
  const flags: FairHousingFlag[] = [];
  for (const rule of FAIR_HOUSING_RULES) {
    if (rule.pattern.test(text)) {
      flags.push({ key: rule.key, ground: rule.ground, message: rule.message });
    }
  }
  return flags;
}

// --- 3. missing persuasive details -----------------------------------------
type DetailProbe = { key: string; label: string; pattern: RegExp };

const DETAIL_PROBES: DetailProbe[] = [
  { key: "light", label: "natural light / exposure", pattern: /\b(light|sunny|bright|south|east|west|north)-?(facing)?\b|\bwindows?\b/ },
  { key: "layout", label: "layout / room feel", pattern: /\b(open concept|layout|spacious|renovated|updated|hardwood|floor plan)\b/ },
  { key: "kitchen", label: "kitchen / appliances", pattern: /\b(kitchen|appliances?|stainless|dishwasher|stove|fridge)\b/ },
  { key: "laundry", label: "laundry", pattern: /\b(laundry|washer|dryer|ensuite laundry|in-?unit)\b/ },
  { key: "parking", label: "parking", pattern: /\bparking|garage|driveway\b/ },
  { key: "transit", label: "transit / commute", pattern: /\b(transit|bus|subway|station|walk score|minutes? to|close to)\b/ },
  { key: "outdoor", label: "balcony / outdoor space", pattern: /\b(balcony|patio|yard|deck|terrace)\b/ },
  { key: "neighbourhood", label: "neighbourhood / nearby", pattern: /\b(neighbou?rhood|shops|restaurants?|park|grocery|nearby|steps to)\b/ },
];

export function missingDetails(description: string | null): string[] {
  const text = (description ?? "").toLowerCase();
  const missing: string[] = [];
  for (const probe of DETAIL_PROBES) {
    if (!probe.pattern.test(text)) missing.push(probe.label);
  }
  return missing;
}
