// ============================================================================
// Pure helpers for the GUIDED DESCRIPTION writer (operator listing form).
// No DOM / env / IO — fully unit-testable (see scripts/test-listing-description.ts).
//
// The problem this solves (from Noam's live-client intake walkthrough 2026-06-18):
// the structured filters capture the checkbox facts (beds, baths, A/C, parking,
// laundry, pets, utilities, availability), but the PERSUASIVE detail - a corner
// unit, the light, open-concept flow, a kitchen pass-through, a breakfast nook -
// has nowhere to go but the free-text description, and operators don't know what
// to write or in what order. This module supplies:
//   1. a hierarchical set of description PROMPTS (most persuasive first), each
//      with concrete examples, scoped to what filters CAN'T hold;
//   2. a "your filters already cover X - don't repeat it" summary built from the
//      unit's own structured fields, so the guidance is specific to this listing;
//   3. a starter outline the form can drop into an empty description box.
// Better descriptions also mean a better syndication feed, so this compounds
// with the listing-feed work. Hyphens, not em dashes (Noam's drafted-copy rule).
// ============================================================================

import {
  buildSpecLine,
  buildAmenityChips,
  utilitiesSummary,
  formatAvailability,
  type UnitFeatures,
} from "./property-features";

// ---------------------------------------------------------------------------
// The hierarchy. Ordered most-persuasive-first: a renter scanning a listing
// decides on feel/light/layout before trim details. Each section is a prompt
// the operator answers, with examples that are explicitly the kind of thing a
// filter cannot represent.
// ---------------------------------------------------------------------------

export type DescriptionSection = {
  key: string;
  // The data-model field this section's answer persists to (Phase 2). Matches
  // Noam's guided-helper spec placeholder names.
  placeholder: string;
  title: string;
  prompt: string;
  examples: string[];
  // Fair-housing reminder shown on sections where wording can stray into
  // protected-ground targeting (the lifestyle/best-fit angle). null elsewhere.
  complianceNote?: string;
};

// The guided hierarchy (Noam's Listing Description Helper spec, 2026-06-18),
// most-persuasive-first. Section 8 of the spec (practical closing line) is
// generated from the structured fields, not asked here. The lifestyle section
// carries a fair-housing reminder: lifestyle fit only, never protected grounds.
export const DESCRIPTION_SECTIONS: DescriptionSection[] = [
  {
    key: "layout_light",
    placeholder: "layout_and_light_notes",
    title: "Layout & light",
    prompt:
      "Describe the layout and feel of the unit. This is what filters can't show.",
    examples: [
      "Open-concept main living area",
      "Corner unit with windows on two sides",
      "Bright and sunny / south-facing",
      "Quiet, rear-facing unit",
      "Efficient layout / separate entrance",
    ],
  },
  {
    key: "special_features",
    placeholder: "special_features_notes",
    title: "Flow & special features",
    prompt:
      "What makes the unit better than a basic rental? Features that may not show up in filters.",
    examples: [
      "Breakfast nook",
      "Kitchen pass-through to the living room",
      "Work-from-home corner",
      "Extra storage / large closets",
      "Character details",
    ],
  },
  {
    key: "condition_finish",
    placeholder: "condition_and_finish_notes",
    title: "Condition & finishes",
    prompt: "Mention the condition or finishes (only what's actually true).",
    examples: [
      "Freshly painted",
      "Updated flooring",
      "Modern kitchen",
      "Clean, neutral bathroom",
      "Newer appliances",
    ],
  },
  {
    key: "practical_extra",
    placeholder: "practical_extra_notes",
    title: "Outdoor, parking, storage, laundry",
    prompt:
      "Practical extras worth explaining (the filters note these; here you add the benefit).",
    examples: [
      "Where the parking spot or carport sits",
      "Laundry location (in-suite, shared, coin-op)",
      "Balcony, deck, yard, or shared outdoor space",
      "Storage locker",
      "Private entrance",
    ],
  },
  {
    key: "building",
    placeholder: "building_notes",
    title: "Building features",
    prompt: "Describe the building, if it helps.",
    examples: [
      "Quiet, small, well-maintained building",
      "Secure entry / intercom",
      "Elevator or walk-up",
      "Duplex / triplex / house",
      "Bike storage, visitor parking",
    ],
  },
  {
    key: "neighbourhood",
    placeholder: "neighbourhood_notes",
    title: "Neighbourhood & nearby",
    prompt: "What's nearby that renters will care about?",
    examples: [
      "Walking distance to transit",
      "Grocery, coffee, restaurants close by",
      "Parks and trails nearby",
      "Near schools, a university, or a hospital",
      "Easy highway access / close to downtown",
    ],
  },
  {
    key: "renter_lifestyle",
    placeholder: "renter_lifestyle_notes",
    title: "Best-fit lifestyle",
    prompt:
      "What kind of rental lifestyle does this unit suit? Keep it about the place, not the person.",
    examples: [
      "Quiet living",
      "Work-from-home setup",
      "Walkable lifestyle",
      "Easy commuting",
      "Low-maintenance space",
    ],
    complianceNote:
      "Describe the lifestyle, never the renter. Avoid anything about family status, age, students, income, or other protected grounds (it's against the Human Rights Code).",
  },
];

// ---------------------------------------------------------------------------
// "Already captured by your filters" — the other half of Noam's idea: guide the
// writing by telling the operator what NOT to repeat. Built from the unit's own
// structured fields so it is specific to this listing, reusing the same pure
// property-features helpers the public page uses (single source of truth).
// ---------------------------------------------------------------------------

export type CapturedInput = UnitFeatures & {
  beds?: number | null;
  baths?: number | null;
  pet_friendly?: boolean | null;
};

/**
 * Human-readable list of the facts the structured filters ALREADY show renters,
 * so the operator doesn't waste description space repeating them. Stable order.
 */
export function summarizeCaptured(unit: CapturedInput): string[] {
  const out: string[] = [];
  // beds / baths / sqft / floor / parking
  for (const spec of buildSpecLine(unit)) out.push(spec);
  // amenity chips (A/C, balcony, laundry, furnished, pet friendly)
  for (const chip of buildAmenityChips(unit)) out.push(chip);
  if (unit.pet_friendly) out.push("Pet friendly");
  // utilities included
  const utils = utilitiesSummary(unit);
  if (utils) out.push(utils);
  // availability
  out.push(formatAvailability(unit.available_date));
  // de-dupe while preserving order (pet friendly can come from both paths)
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One-line "don't repeat these" sentence, or null when nothing is captured yet. */
export function capturedSummaryLine(unit: CapturedInput): string | null {
  const items = summarizeCaptured(unit);
  if (items.length === 0) return null;
  const joined =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `Your filters already show renters: ${joined}. No need to repeat these - use the description for what they can't capture.`;
}

// ---------------------------------------------------------------------------
// Starter outline — what the form drops into an empty description box so the
// operator writes against a structure instead of a blank field.
// ---------------------------------------------------------------------------

/**
 * A blank-but-structured starter the operator fills in. One labelled line per
 * section so the hierarchy is visible; the operator replaces each "- " line.
 * Pure text, hyphens only, no links (feed-safe downstream).
 */
export function buildDescriptionScaffold(
  sections: ReadonlyArray<DescriptionSection> = DESCRIPTION_SECTIONS,
): string {
  return sections.map((s) => `${s.title}:\n- `).join("\n\n");
}

/** True when a description is effectively empty (so it's safe to drop the scaffold in). */
export function isDescriptionBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

// ---------------------------------------------------------------------------
// Starter-draft GENERATOR — assembles a natural-reading description from the
// operator's guided answers PLUS the structured listing fields, in the spec's
// hierarchy (strongest appeal first, never the bedroom count; practical details,
// then building/neighbourhood, then availability + a viewing CTA). Deterministic
// and pure: it only uses facts that were actually provided (it never invents
// renovations, square footage, transit times, or anything else), strips links,
// and avoids all-caps. The operator edits the result; it is a starter, not a
// final. The "make it warmer / shorter / professional" rewrites in Noam's spec
// are a later LLM-backed layer; this is the no-AI core.
// ---------------------------------------------------------------------------

export type GuidedAnswers = Partial<Record<string, string>>;

export type DraftFacts = CapturedInput & {
  unit_type?: string | null; // e.g. "apartment"; omitted from copy when absent
  rent_cents?: number | null;
};

function cleanAnswer(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/\bwww\.[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return v || null;
}

/** Trim, l-case any SHOUTING, capitalize first letter, ensure terminal period. */
function toSentence(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  // De-shout: a long run of all-caps becomes sentence case.
  if (s.length > 3 && s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s.toLowerCase();
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function joinList(items: string[]): string {
  const x = items.filter(Boolean);
  if (x.length === 0) return "";
  if (x.length === 1) return x[0];
  if (x.length === 2) return `${x[0]} and ${x[1]}`;
  return `${x.slice(0, -1).join(", ")}, and ${x[x.length - 1]}`;
}

/**
 * Build a starter description. Returns "" only when there is genuinely nothing
 * to say (no answers and no structured facts). Paragraphs are separated by a
 * blank line.
 */
export function buildDescriptionDraft(
  facts: DraftFacts,
  answers: GuidedAnswers = {},
): string {
  const a = (key: string) => cleanAnswer(answers[key]);
  const unitDescriptor =
    (facts.beds != null ? `${facts.beds}-bedroom ` : "") +
    (cleanAnswer(facts.unit_type) ?? "unit");

  // 1. Opening: lead with the layout/feel, not the bedroom count.
  const layout = a("layout_and_light_notes");
  const opening = layout
    ? toSentence(layout)
    : toSentence(`Comfortable ${unitDescriptor} available for rent`);

  // 2. Unit body: features + condition, anchored to the unit descriptor.
  const unitBits: string[] = [];
  const features = a("special_features_notes");
  const condition = a("condition_and_finish_notes");
  if (features) unitBits.push(features);
  if (condition) unitBits.push(condition);
  const unitSentence =
    unitBits.length > 0
      ? toSentence(`This ${unitDescriptor} offers ${joinList(unitBits)}`)
      : layout
        ? toSentence(`A practical ${unitDescriptor}`)
        : "";

  // 3. Practical details: operator's extra notes + the structured practicals
  //    (laundry, A/C, balcony, furnished, included utilities, parking).
  const practicalBits: string[] = [];
  const extra = a("practical_extra_notes");
  if (extra) practicalBits.push(extra);
  const chips = buildAmenityChips(facts).map((c) => c.toLowerCase());
  const utils = utilitiesSummary(facts);
  const structuredPracticals = [...chips];
  if (facts.parking && String(facts.parking).trim())
    structuredPracticals.push(`parking (${String(facts.parking).trim()})`);
  let practicalSentence = "";
  if (practicalBits.length > 0)
    practicalSentence = toSentence(practicalBits.join("; "));
  if (structuredPracticals.length > 0)
    practicalSentence +=
      (practicalSentence ? " " : "") +
      toSentence(`The unit includes ${joinList(structuredPracticals)}`);
  if (utils) practicalSentence += (practicalSentence ? " " : "") + toSentence(utils);

  // 4. Building + neighbourhood + lifestyle (lifestyle stays compliance-safe).
  const placeBits: string[] = [];
  const building = a("building_notes");
  const hood = a("neighbourhood_notes");
  const lifestyle = a("renter_lifestyle_notes");
  if (building) placeBits.push(toSentence(building));
  if (hood) placeBits.push(toSentence(`Close to ${hood}`));
  if (lifestyle) placeBits.push(toSentence(`Well-suited to ${lifestyle}`));
  const placeSentence = placeBits.join(" ");

  // 5. Closing: availability + rent + viewing CTA.
  const closeBits: string[] = [];
  const avail = formatAvailability(facts.available_date);
  closeBits.push(toSentence(avail));
  if (facts.rent_cents != null && facts.rent_cents > 0)
    closeBits.push(
      toSentence(`Rent is $${(Math.round(facts.rent_cents) / 100).toFixed(0)} per month`),
    );
  closeBits.push("Inquire to book a viewing.");
  const closing = closeBits.join(" ");

  const para1 = [opening, unitSentence].filter(Boolean).join(" ");
  const para2 = practicalSentence;
  const para3 = placeSentence;
  return [para1, para2, para3, closing].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Fair-housing / Human Rights Code guard. The description must never target or
// exclude people on protected grounds. This flags risky phrasing in the
// operator's own answers (or a generated draft) and suggests a neutral
// rewrite. It does NOT silently edit; it warns, so the operator stays in control.
// ---------------------------------------------------------------------------

export type ComplianceFlag = { match: string; suggestion: string };

const DISCRIMINATORY_PATTERNS: Array<{ re: RegExp; suggestion: string }> = [
  { re: /\bno\s+children\b/i, suggestion: "Remove - excluding children is not permitted. Describe the space instead (e.g. quiet building)." },
  { re: /\b(adults?\s+only|mature\s+(tenants?|adults?)\s*(only)?)\b/i, suggestion: "Remove - age/family targeting is not permitted." },
  { re: /\bno\s+students?\b|\bstudents?\s+only\b/i, suggestion: "Remove unless the housing is legitimately student-specific and legally reviewed." },
  { re: /\b(working\s+)?professionals?\s+only\b/i, suggestion: "Remove - employment targeting is not permitted. Try 'well-suited to a quiet, low-maintenance lifestyle'." },
  { re: /\b(single\s+person|couples?)\s+only\b/i, suggestion: "Remove - household-type targeting is not permitted." },
  { re: /\bnot\s+suitable\s+for\s+(families|children|kids)\b/i, suggestion: "Remove - family-status exclusion is not permitted." },
  { re: /\bfemale\s+only\b|\bmale\s+only\b/i, suggestion: "Remove unless this is shared accommodation and legally reviewed." },
  { re: /\bno\s+(odsp|ow|social\s+assistance|welfare)\b/i, suggestion: "Remove - source-of-income discrimination is not permitted." },
  { re: /\bmust\s+have\s+(a\s+)?(full[-\s]?time\s+)?job\b/i, suggestion: "Remove - source-of-income/employment requirements are not permitted here." },
  { re: /\bno\s+newcomers?\b|\bcitizens?\s+only\b/i, suggestion: "Remove - citizenship/place-of-origin targeting is not permitted." },
  { re: /\b(christian|muslim|jewish|catholic|hindu|sikh)\s+(preferred|only)\b/i, suggestion: "Remove - religious targeting is not permitted." },
  { re: /\bno\s+pets?\b/i, suggestion: "In Ontario a no-pets term is void (RTA s.14). State the pet preference at the listing level, not as a rule." },
];

/** Scan text for protected-ground / non-compliant phrasing. Empty = clean. */
export function flagDiscriminatoryLanguage(
  text: string | null | undefined,
): ComplianceFlag[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const flags: ComplianceFlag[] = [];
  for (const { re, suggestion } of DISCRIMINATORY_PATTERNS) {
    const m = re.exec(text);
    if (m) flags.push({ match: m[0], suggestion });
  }
  return flags;
}

/** Convenience: scan all guided answers, return any flags found. */
export function flagAnswers(answers: GuidedAnswers): ComplianceFlag[] {
  const joined = Object.values(answers).filter(Boolean).join("\n");
  return flagDiscriminatoryLanguage(joined);
}
