// ============================================================================
// Lease extraction - the IMPURE half: send lease content to a model and get back
// a normalized LeaseDraft (S425). The deterministic contract (schema, prompt,
// normalizer, the PII guard) lives in lib/lease-extract.ts and is unit-tested;
// THIS file is just the network call + wiring, kept thin on purpose. Mirrors
// lib/asset-capture-vision.ts.
//
// TWO INPUT PATHS, one contract:
// - TEXT (the common case): the New-Tenancy client extracts the FIRST 8 PAGES
//     of the lease PDF with pdfjs in the browser (same approach as the MLS
//     PDF-drop import, app/dashboard/properties/mls-pdf-import.tsx) and posts the
//     text here. A generated / e-signed Ontario lease is a text PDF, so this is
//     cheap, fast, and naturally page-capped. No server-side pdf/canvas.
// - IMAGE: a photographed lease page -> the Anthropic image block (same shape
//     asset-capture uses). Covers a scanned/photo lease; wired as a follow-up.
//
// GATED / DARK: with no ANTHROPIC_API_KEY set, parseLease returns
// {ok:false, reason:"unconfigured"} and the UI silently falls back to the manual
// tenancy form - so this ships inert until Noam sets the key in Vercel
// (Sensitive). Per feedback_sandbox_chrome_no_external_api the live call can't be
// exercised from the build sandbox; the request shape is fixed to the documented
// Anthropic Messages API and live-proves on the first deploy (QA on North Star
// with a SYNTHETIC lease, never a real tenant's lease).
//
// PII / data posture (Layer 3): the lease content is sent to the model
// transiently and is NOT persisted by this path. The returned draft is run
// through lib/lease-extract.ts's PII guard (Layer 2) before it reaches the UI/DB.
// ============================================================================

import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  extractJsonObject,
  normalizeLeaseDraft,
  isEmptyLeaseDraft,
  isAsciiApiKey,
  type LeaseParseResult,
} from "./lease-extract";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Haiku tier: a structured-extraction read over a few pages of lease text is a
 * small job. Overridable via env so the model can be bumped without a code
 * change. */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
/** A lease draft + clause digest is a bigger object than an appliance plate. */
const MAX_TOKENS = 1500;
/** Hard ceiling on the call so a slow upstream can't hang a server action. */
const TIMEOUT_MS = 30_000;
/** Bound the input tokens: the client already caps to 8 pages, but clamp the raw
 * text too so a pathological PDF can't blow the request up. ~40k chars is well
 * within an 8-page lease and keeps the call cheap. */
const MAX_INPUT_CHARS = 40_000;

/** Media types the Anthropic image block accepts (matches asset-capture). */
export const VISION_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type VisionImageType = (typeof VISION_IMAGE_TYPES)[number];

export function isVisionImageType(mime: unknown): mime is VisionImageType {
  return typeof mime === "string" && (VISION_IMAGE_TYPES as readonly string[]).includes(mime);
}

/** Cap the number of page images sent so a big located window can't blow up the
 * request (the locator already bounds the window to LEASE_WINDOW_PAGES). */
const MAX_IMAGES = 8;

/** The ways lease content arrives. TEXT = extracted PDF text (fast path for clean
 * text leases). IMAGE(S) = page rasters the client made from the LOCATED lease
 * pages - the robust path for signed/flattened OREA forms whose filled values
 * scramble in text extraction, since the model sees each value beside its label
 * (Noam, S425, 50 Glenrose). */
export type LeaseImage = { base64: string; mimeType: VisionImageType };
export type LeaseSource =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Buffer; mimeType: string }
  | { kind: "images"; images: LeaseImage[] };

/**
 * Parse lease content into a LeaseDraft. Never throws - every failure maps to a
 * typed {ok:false} reason so the caller can branch without try/catch:
 * - "unconfigured": no API key (ships dark), a bad key, an unsupported image
 *                     type, or empty text.
 * - "failed":       network / HTTP / parse error.
 * - "empty":        the model read nothing usable (all core fields null).
 */
export async function parseLease(source: LeaseSource): Promise<LeaseParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "unconfigured" };
  // A non-ASCII key (e.g. a hyphen autocorrected to an em dash on paste) makes
  // fetch throw a raw ByteString TypeError building the x-api-key header (KI555);
  // treat it as a config problem, not a transient failure.
  if (!isAsciiApiKey(apiKey)) {
    console.error(
      "parseLease: ANTHROPIC_API_KEY contains a non-ASCII character " +
        "(likely an autocorrected dash or smart quote); treating as unconfigured",
    );
    return { ok: false, reason: "unconfigured" };
  }

  const content = buildUserContent(source);
  if (!content) return { ok: false, reason: "unconfigured" };

  const model = process.env.LEASE_EXTRACT_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: EXTRACTION_SYSTEM_PROMPT,
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
    console.error("parseLease: request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.error("parseLease: non-200 from model", { status: res.status });
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
    console.error("parseLease: response parse failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "failed" };
  }

  const draft = normalizeLeaseDraft(extractJsonObject(text));
  if (!draft) return { ok: false, reason: "failed" };
  if (isEmptyLeaseDraft(draft)) return { ok: false, reason: "empty" };
  return { ok: true, draft };
}

/** Build the user-message content array for either input path. Returns null when
 * the input is unusable (empty text / unsupported image type), which the caller
 * maps to "unconfigured" (fall back to the manual form). */
function buildUserContent(
  source: LeaseSource,
): Array<Record<string, unknown>> | null {
  if (source.kind === "text") {
    const clean = source.text.trim().slice(0, MAX_INPUT_CHARS);
    if (!clean) return null;
    return [
      { type: "text", text: "Lease text (located pages):\n\n" + clean },
      { type: "text", text: buildExtractionPrompt() },
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
      { type: "text", text: buildExtractionPrompt() },
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
    { type: "text", text: buildExtractionPrompt() },
  ];
}
