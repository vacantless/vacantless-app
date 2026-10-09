"use server";

// S702: the AI hook line for the video ad. Never throws; null means use the
// plain fallback line.
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { callClaudeText } from "@/lib/ai-call";
import { listingFacts } from "@/lib/ai-enquiry";
import { HOOK_SYSTEM_PROMPT, cleanHook } from "@/lib/video-ad";

export async function videoAdHook(propertyId: string): Promise<string | null> {
  try {
    const org = await getCurrentOrg();
    if (!org) return null;
    const supabase = createClient();
    const { data: p } = await supabase
      .from("properties")
      .select("*")
      .eq("id", propertyId)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (!p) return null;
    const facts = listingFacts({ ...(p as Record<string, unknown>), address: null, rent_cents: null });
    if (!facts.trim()) return null;
    const text = await callClaudeText({
      system: HOOK_SYSTEM_PROMPT,
      content: `Facts:\n${facts}`,
      maxTokens: 40,
      timeoutMs: 8000,
    });
    return cleanHook(text);
  } catch {
    return null;
  }
}
