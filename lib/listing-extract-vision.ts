// ============================================================================
// AI listing extraction - the IMPURE half: send listing content to a model and
// get back a normalized ListingDraft (Feature B, S428). The deterministic
// contract (schema, prompt, normalizer, merge) lives in lib/listing-extract.ts
// and is unit-tested; THIS file is just the network call + wiring, kept thin on
// purpose. Mirrors lib/lease-extract-vision.ts (same never-throws typed union,
// same ASCII-key guard, same timeout), minus the PII posture - a listing is
// public marketing copy, not a tenant record.
//
// TWO INPUT PATHS, one contract:
// - TEXT (the common case): the operator pastes a Kijiji/Facebook/PM-page blurb;
//     the same textarea the MLS paste box uses posts the raw text here.
// - IMAGE(S): a photographed / screenshotted listing -> the Anthropic image
//     block (same shape asset-capture / lease-extract use). Covers a listing that
//     only exists as a picture; wired for a client that rasterizes a page.
//
// GATED / DARK: with no ANTHROPIC_API_KEY set, parseListing returns
// {ok:false, reason:"unconfigured"} and the caller keeps the deterministic
// parse - so this ships inert until Noam sets the key in Vercel (Sensitive). Per
// feedback_sandbox_chrome_no_external_api the live call can't be exercised from
// the build sandbox; the request shape is fixed to the documented Anthropic
// Messages API and live-proves on the first deploy (QA on North Star).
// ============================================================================

import {
  LISTING_SYSTEM_PROMPT,
  buildListingExtractionPrompt,
  extractJsonObject,
  normalizeListingDraft,
  isEmptyListingDraft,
  isAsciiApiKey,
  type ListingParseResult,
} from "./listing-extract";
import {
  isVisionImageType,
  type VisionImageType,
} from "./lease-extract-vision";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Haiku tier: a structured read over a short listing blurb is a small job.
 * Overridable via env so the model can be bumped without a code change. */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
/** A listing draft is a flat object; 1200 output tokens is ample. */
const MAX_TOKENS = 1200;
/** Hard ceiling so a slow upstream can't hang a server action. */
const TIMEOUT_MS = 30_000;
/** Bound the input: a real listing blurb is short; clamp so a pathological paste
 * can't blow the request up. */
const MAX_INPUT_CHARS = 40_000;
/** Cap the number of page images sent. */
const MAX_IMAGES = 4;

/** The ways listing content arrives. */
export type ListingImage = { base64: string; mimeType: VisionImageType };
export type ListingSource =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Buffer; mimeType: string }
  | { kind: "images"; images: ListingImage[] };

/**
 * Parse listing content into a ListingDraft. Never throws - every failure maps
 * to a typed {ok:false} reason so the caller can branch without try/catch:
 * - "unconfigured": no API key (ships dark), a bad key, an unsupported image
 *                     type, or empty text.
 * - "failed":       network / HTTP / parse error.
 * - "empty":        the model read nothing usable (all fields null).
 */
export async function parseListing(source: ListingSource): Promise<ListingParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "unconfigured" };
  // A non-ASCII key (e.g. a hyphen autocorrected to an em dash on paste) makes
  // fetch throw a raw ByteString TypeError building the x-api-key header (KI555);
  // treat it as a config problem, not a transient failure.
  if (!isAsciiApiKey(apiKey)) {
    console.error(
      "parseListing: ANTHROPIC_API_KEY contains a non-ASCII character " +
        "(likely an autocorrected dash or smart quote); treating as unconfigured",
    );
    return { ok: false, reason: "unconfigured" };
  }

  const content = buildUserContent(source);
  if (!content) return { ok: false, reason: "unconfigured" };

  const model = process.env.LISTING_EXTRACT_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: LISTING_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    console.error("parseListing: request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.error("parseListing: non-200 from model", { status: res.status });
    return { ok: false, reason: "failed" };
  }

  let text: string | null = null;
  try {
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    text =
      json.content?.find((b) => b.type === "text" && typeof b.text === "string")?.text ?? null;
  } catch (err) {
    console.error("parseListing: response parse failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "failed" };
  }

  const draft = normalizeListingDraft(extractJsonObject(text));
  if (!draft) return { ok: false, reason: "failed" };
  if (isEmptyListingDraft(draft)) return { ok: false, reason: "empty" };
  return { ok: true, draft };
}

/** Build the user-message content array for either input path. Returns null when
 * the input is unusable (empty text / unsupported image type), which the caller
 * maps to "unconfigured" (keep the deterministic parse). */
function buildUserContent(
  source: ListingSource,
): Array<Record<string, unknown>> | null {
  if (source.kind === "text") {
    const clean = source.text.trim().slice(0, MAX_INPUT_CHARS);
    if (!clean) return null;
    return [
      { type: "text", text: "Listing content:\n\n" + clean },
      { type: "text", text: buildListingExtractionPrompt() },
    ];
  }
  if (source.kind === "images") {
    const imgs = source.images.filter((im) => isVisionImageType(im.mimeType)).slice(0, MAX_IMAGES);
    if (imgs.length === 0) return null;
    return [
      ...imgs.map((im) => ({
        type: "image",
        source: { type: "base64", media_type: im.mimeType, data: im.base64 },
      })),
      { type: "text", text: buildListingExtractionPrompt() },
    ];
  }
  if (!isVisionImageType(source.mimeType)) return null;
  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: source.mimeType,
        data: source.bytes.toString("base64"),
      },
    },
    { type: "text", text: buildListingExtractionPrompt() },
  ];
}
