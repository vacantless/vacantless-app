// ============================================================================
// Asset capture — the IMPURE half: send a captured image to a multimodal model
// and get back a normalized AssetDraft (S364). The deterministic contract (the
// JSON schema, the prompt, the normalizer) lives in lib/asset-capture.ts and is
// unit-tested; THIS file is just the network call + wiring, kept thin on purpose.
//
// ENGINE CHOICE (see CAPTURE-PHOTO-OCR-EMAIL-IN-DESIGN-2026-06-28.md §4): a
// multimodal model reads a noisy nameplate / receipt straight into structured
// fields — the one approach that handles every manufacturer's plate layout AND
// receipts without per-format regex, and the same engine the expense ledger
// (receipt mode) reuses. Swappable: the model id is an env var, and everything
// downstream depends only on the AssetDraft contract, not on the provider.
//
// GATED / DARK: with no ANTHROPIC_API_KEY set, parseAssetImage returns
// {ok:false, reason:"unconfigured"} and the UI silently falls back to the manual
// add form — so this ships inert until Noam sets the key in Vercel (Sensitive).
// Per feedback_sandbox_chrome_no_external_api the live call can't be exercised
// from the build sandbox; the request shape is fixed to the documented Anthropic
// Messages API and live-proves on the first deploy (QA on North Star).
//
// PII / data posture: the image bytes are sent to the model transiently and are
// NOT persisted by this path (Phase 1 discards them after parsing). A nameplate
// / store receipt is the landlord's own asset/transaction record, not tenant PII.
// ============================================================================

import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  extractJsonObject,
  normalizeAssetDraft,
  isEmptyDraft,
  isAsciiApiKey,
  type AssetParseResult,
} from "./asset-capture";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Haiku is the right tier for a short structured-extraction read: fast + cheap.
 * Overridable so the model can be bumped without a code change. */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
/** A plate/receipt extraction is a small JSON object; cap output tightly. */
const MAX_TOKENS = 512;
/** Hard ceiling on the call so a slow upstream can't hang a server action. */
const TIMEOUT_MS = 25_000;

/** Media types the Anthropic image block accepts (matches what the scan action
 * already restricts the upload to). */
export const VISION_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type VisionImageType = (typeof VISION_IMAGE_TYPES)[number];

export function isVisionImageType(mime: unknown): mime is VisionImageType {
  return typeof mime === "string" && (VISION_IMAGE_TYPES as readonly string[]).includes(mime);
}

/**
 * Parse a captured image into an AssetDraft. Never throws — every failure maps
 * to a typed {ok:false} reason so the caller can branch without try/catch:
 *   - "unconfigured": no API key (ships dark) OR an unsupported media type.
 *   - "failed":       network/HTTP/parse error.
 *   - "empty":        the model read nothing usable (all fields null).
 */
export async function parseAssetImage(
  bytes: Buffer,
  mimeType: string,
): Promise<AssetParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "unconfigured" };
  // A non-ASCII key (e.g. a hyphen autocorrected to an em dash on paste) would
  // make fetch throw a raw ByteString TypeError when building the x-api-key
  // header; treat it as a config problem, not a transient failure (KI555).
  if (!isAsciiApiKey(apiKey)) {
    console.error(
      "parseAssetImage: ANTHROPIC_API_KEY contains a non-ASCII character " +
        "(likely an autocorrected dash or smart quote from a paste); treating as unconfigured",
    );
    return { ok: false, reason: "unconfigured" };
  }
  if (!isVisionImageType(mimeType)) return { ok: false, reason: "unconfigured" };

  const model = process.env.ASSET_CAPTURE_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: bytes.toString("base64"),
            },
          },
          { type: "text", text: buildExtractionPrompt() },
        ],
      },
    ],
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
    console.error("parseAssetImage: request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.error("parseAssetImage: non-200 from model", { status: res.status });
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
    console.error("parseAssetImage: response parse failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "failed" };
  }

  const draft = normalizeAssetDraft(extractJsonObject(text));
  if (!draft) return { ok: false, reason: "failed" };
  if (isEmptyDraft(draft)) return { ok: false, reason: "empty" };
  return { ok: true, draft };
}
