// ai-call.ts (S702). One small Anthropic Messages call shared by the S702 AI
// features (enquiry reader, renter answers, screenshot reader, form filler).
// Never throws: returns null when the key is missing, the call fails or times
// out, so every caller keeps working without AI.
import { isAsciiApiKey } from "./listing-extract";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
export const AI_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export type AiContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export function aiConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return Boolean(key && isAsciiApiKey(key));
}

export async function callClaudeText(args: {
  system: string;
  content: string | AiContentBlock[];
  maxTokens?: number;
  model?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !isAsciiApiKey(apiKey)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 20_000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: args.model || process.env.S702_AI_MODEL || AI_DEFAULT_MODEL,
        max_tokens: args.maxTokens ?? 800,
        system: args.system,
        messages: [{ role: "user", content: args.content }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    return json.content?.find((b) => b.type === "text" && typeof b.text === "string")?.text ?? null;
  } catch (err) {
    console.error("callClaudeText failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first {...} object out of a model reply. */
export function firstJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
