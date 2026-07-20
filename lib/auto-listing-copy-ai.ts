// Impure AI adapter for S532 auto listing copy. It is intentionally optional:
// every failure returns null so callers can use deterministicAutoDescription.

import { isAsciiApiKey } from "./listing-extract";
import { usableAutoDescription } from "./auto-listing-copy";
import type { DraftFacts } from "./listing-description";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 500;
const TIMEOUT_MS = 12_000;

function factLines(facts: DraftFacts): string[] {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    if (typeof value === "boolean") {
      if (value) lines.push(`${label}: yes`);
      return;
    }
    lines.push(`${label}: ${String(value)}`);
  };

  add("Bedrooms", facts.beds);
  add("Bathrooms", facts.baths);
  add("Unit type", facts.unit_type);
  if (
    typeof facts.rent_cents === "number" &&
    Number.isFinite(facts.rent_cents) &&
    facts.rent_cents > 0
  ) {
    add("Monthly rent", `$${Math.round(facts.rent_cents / 100)} per month`);
  }
  add("Square feet", facts.sqft);
  add("Floor", facts.floor);
  add("Parking", facts.parking);
  add("Laundry", facts.laundry);
  add("Air conditioning", facts.air_conditioning);
  add("Balcony", facts.balcony);
  add("Furnished", facts.furnished);
  add("Pet friendly", facts.pet_friendly);
  add("Cats allowed", facts.pets_cats);
  add("Dogs allowed", facts.pets_dogs);
  add("Dog size", facts.pets_dog_size);
  add("Pet notes", facts.pets_notes);
  add("Heat included", facts.heat_included);
  add("Hydro included", facts.hydro_included);
  add("Water included", facts.water_included);
  add("Available date", facts.available_date);
  return lines;
}

function buildPrompt(facts: DraftFacts, fallbackDraft: string | null): string {
  const lines = factLines(facts);
  return [
    "Write a concise residential rental listing description from ONLY the facts below.",
    "Do not add or imply any feature, renovation, neighbourhood, amenity, policy, price, or claim that is not supplied.",
    "Do not target or exclude people. Describe the unit, not the renter.",
    "No links. No em dashes. Plain text only. Two or three short paragraphs.",
    "If the facts are too thin, lightly polish the fallback draft without adding facts.",
    "",
    "Facts:",
    lines.length > 0 ? lines.join("\n") : "No structured facts supplied.",
    "",
    "Fallback draft:",
    fallbackDraft ?? "",
  ].join("\n");
}

export async function draftAutoListingDescriptionWithAi(
  facts: DraftFacts,
  fallbackDraft: string | null,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !isAsciiApiKey(apiKey)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: process.env.AUTO_LISTING_COPY_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system:
          "You write honest rental listing copy. You never invent facts and you never auto-submit or publish anything.",
        messages: [
          {
            role: "user",
            content: buildPrompt(facts, fallbackDraft),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text =
      json.content?.find((block) => block.type === "text" && typeof block.text === "string")
        ?.text ?? null;
    return usableAutoDescription(text);
  } catch (err) {
    console.error("draftAutoListingDescriptionWithAi failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
