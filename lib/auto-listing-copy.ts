// Pure model for S532 auto listing copy. The server can call an AI adapter, but
// the decision to write stays small and testable: dark flag on, saved
// description blank, AI text usable or deterministic fallback.

import {
  buildDescriptionDraft,
  type DraftFacts,
} from "./listing-description";
import {
  clampDescription,
  MIN_DESCRIPTION_CHARS,
} from "./listing-feed";

export type AutoListingCopySource = "disabled" | "existing" | "ai" | "deterministic";

export type AutoListingCopyDecision = {
  shouldWrite: boolean;
  description: string | null;
  source: AutoListingCopySource;
};

export function envFlagEnabled(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function descriptionNeedsAutoDraft(
  description: string | null | undefined,
): boolean {
  return !description || description.trim().length === 0;
}

export function usableAutoDescription(
  value: string | null | undefined,
): string | null {
  const clean = clampDescription(value ?? null);
  if (!clean || clean.length < MIN_DESCRIPTION_CHARS) return null;
  return clean.replace(/[—–]/g, "-");
}

export function deterministicAutoDescription(
  facts: DraftFacts,
): string | null {
  return usableAutoDescription(buildDescriptionDraft(facts, {}));
}

export function chooseAutoListingCopy({
  enabled,
  currentDescription,
  facts,
  aiDescription,
}: {
  enabled: boolean;
  currentDescription: string | null | undefined;
  facts: DraftFacts;
  aiDescription?: string | null;
}): AutoListingCopyDecision {
  if (!enabled) {
    return { shouldWrite: false, description: null, source: "disabled" };
  }
  if (!descriptionNeedsAutoDraft(currentDescription)) {
    return { shouldWrite: false, description: null, source: "existing" };
  }

  const ai = usableAutoDescription(aiDescription ?? null);
  if (ai) {
    return { shouldWrite: true, description: ai, source: "ai" };
  }

  const fallback = deterministicAutoDescription(facts);
  if (!fallback) {
    return { shouldWrite: false, description: null, source: "deterministic" };
  }
  return { shouldWrite: true, description: fallback, source: "deterministic" };
}
