// Impure AI adapter for the S553 done-for-you posting worker. Intentionally
// optional and DARK: with no ANTHROPIC_API_KEY (or a non-ASCII key) it returns
// { composed: null, skipped: "no_key" } and the worker still records the job and
// routes it to the correct human gate — the person composes. Modeled exactly on
// lib/auto-listing-copy-ai.ts (same URL, version, timeout, no-throw posture, no
// secrets logged). It ONLY composes copy; it never logs in, pays, or submits.

import { isAsciiApiKey } from "./listing-extract";
import {
  buildAgentComposePrompt,
  type WorkerListingFacts,
} from "./distribution-worker";
import type { RunStep } from "./distribution-run";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 800;
const TIMEOUT_MS = 15_000;

export type ComposeResult = {
  /** The composed draft + checklist, or null when unavailable. */
  composed: string | null;
  /** Why nothing was composed (null on success). */
  skipped: "no_key" | "error" | null;
};

export async function composePostWithAgent(input: {
  channelKey: string;
  channelLabel: string;
  listing: WorkerListingFacts;
  steps: RunStep[];
}): Promise<ComposeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !isAsciiApiKey(apiKey)) return { composed: null, skipped: "no_key" };

  const prompt = buildAgentComposePrompt(input);
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
        model: process.env.DISTRIBUTION_WORKER_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { composed: null, skipped: "error" };
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text =
      json.content?.find(
        (block) => block.type === "text" && typeof block.text === "string",
      )?.text ?? null;
    const trimmed = text?.trim();
    return trimmed ? { composed: trimmed, skipped: null } : { composed: null, skipped: "error" };
  } catch (err) {
    console.error("composePostWithAgent failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { composed: null, skipped: "error" };
  } finally {
    clearTimeout(timer);
  }
}
