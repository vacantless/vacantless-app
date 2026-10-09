// ai-enquiry-server.ts (S702). The network half of lib/ai-enquiry.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaudeText, firstJsonObject } from "./ai-call";
import {
  ANSWER_SYSTEM_PROMPT,
  ENQUIRY_SYSTEM_PROMPT,
  buildAnswerPrompt,
  buildEnquiryPrompt,
  listingFacts,
  normalizeEnquiryRead,
  usableAnswer,
  worthAnswering,
  type EnquiryEmail,
  type EnquiryRead,
  type EnquiryRental,
} from "./ai-enquiry";
import { SCREENSHOT_SYSTEM_PROMPT, buildScreenshotPrompt } from "./ai-screenshot-lead";

export async function readEnquiryWithAi(
  email: EnquiryEmail,
  rentals: EnquiryRental[],
  blockedEmails: string[] = [],
): Promise<EnquiryRead | null> {
  const text = await callClaudeText({
    system: ENQUIRY_SYSTEM_PROMPT,
    content: buildEnquiryPrompt(email, rentals),
    maxTokens: 500,
  });
  return normalizeEnquiryRead(firstJsonObject(text), rentals, blockedEmails);
}

/** The org's open rentals in the shape the reader wants. */
export async function openRentalsForOrg(
  admin: SupabaseClient,
  orgId: string,
): Promise<EnquiryRental[]> {
  const { data } = await admin
    .from("properties")
    .select("id, address, rent_cents, beds, status, archived_at")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .in("status", ["available", "draft"])
    .limit(60);
  return ((data ?? []) as Array<{ id: string; address: string | null; rent_cents: number | null; beds: number | null }>).map(
    (p) => ({
      id: p.id,
      address: p.address ?? "",
      rentDollars: typeof p.rent_cents === "number" ? Math.round(p.rent_cents / 100) : null,
      beds: p.beds,
    }),
  );
}

/** One or two sentences answering the renter from the rental's own facts, or null. */
export async function answerRenterQuestion(
  admin: SupabaseClient,
  propertyId: string,
  question: string | null | undefined,
): Promise<string | null> {
  if (!worthAnswering(question)) return null;
  const { data } = await admin.rpc("get_public_listing", { p_property_id: propertyId });
  if (!data || typeof data !== "object") return null;
  const facts = listingFacts(data as Record<string, unknown>);
  if (!facts) return null;
  const text = await callClaudeText({
    system: ANSWER_SYSTEM_PROMPT,
    content: buildAnswerPrompt(question, facts),
    maxTokens: 160,
    timeoutMs: 8_000,
  });
  return usableAnswer(text);
}

/** Read a chat screenshot (S702). Null when AI is off or the reply is unusable. */
export async function readScreenshotWithAi(
  image: { mediaType: string; base64: string },
  rentals: EnquiryRental[],
): Promise<EnquiryRead | null> {
  const text = await callClaudeText({
    system: SCREENSHOT_SYSTEM_PROMPT,
    content: [
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
      { type: "text", text: buildScreenshotPrompt(rentals) },
    ],
    maxTokens: 500,
    timeoutMs: 25_000,
  });
  return normalizeEnquiryRead(firstJsonObject(text), rentals);
}
