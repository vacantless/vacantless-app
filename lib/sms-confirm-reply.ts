// S750: a renter who answers a viewing text with "yes", "ok", a thumbs-up or a
// tapback ("Liked ...") has confirmed the viewing. Before this, only the
// confirm link set showings.confirmed_at, so a renter who replied "Yes" to
// "Not confirmed yet ... Reply here to keep it" still looked unconfirmed and
// could lose the time.
//
// Kept strict on purpose: a short message whose words are all agreement words,
// or a tapback. Anything with a question, a "no", "can't", "cancel",
// "reschedule" or "late" is NOT a confirmation and stays a plain reply.

export type ConfirmClient = { from(table: string): any };

const AGREE_WORDS = new Set([
  "yes", "y", "yeah", "yea", "yep", "yup", "ya", "ye", "ok", "okay", "k", "kk", "okk",
  "sure", "confirm", "confirmed", "confirming", "definitely", "absolutely", "perfect",
  "great", "sounds", "good", "will", "be", "there", "see", "you", "then", "thanks",
  "thank", "thx", "ty", "i", "ill", "i'll", "im", "i'm", "coming", "still", "on",
  "for", "it", "works", "sir", "maam", "please", "and", "yes,", "all", "set",
]);
const NEGATIVE = /\b(no|not|nope|can'?t|cannot|cant|won'?t|unable|cancel\w*|reschedul\w*|change|late|later|another|different|instead|but)\b/i;
const THUMBS = /^[\s\u{1F44D}\u{1F44C}\u{2705}\u{2714}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{1F64F}\u{1F60A}\u{1F642}\u{263A}!.]+$/u;
const TAPBACK = /^(liked|loved|emphasi[sz]ed|reacted\s+\S+\s+to)\s+["“‘']/i;

/** True if the text is a plain agreement (yes, ok, thumbs-up, a tapback). Pure. */
export function isConfirmReply(body: string | null | undefined): boolean {
  const text = (body ?? "").trim();
  if (!text || text.length > 80) return false;
  if (TAPBACK.test(text)) return true;
  if (THUMBS.test(text)) return true;
  if (text.includes("?")) return false;
  if (NEGATIVE.test(text)) return false;
  const words = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return THUMBS.test(text);
  if (words.length > 8) return false;
  const first = words[0];
  if (!["yes", "y", "yeah", "yea", "yep", "yup", "ya", "ye", "ok", "okay", "k", "kk", "okk", "sure", "confirm", "confirmed", "confirming", "definitely", "absolutely", "perfect", "great", "sounds", "will", "i", "ill", "i'll", "im", "i'm", "see", "still"].includes(first)) {
    return false;
  }
  return words.every((w) => AGREE_WORDS.has(w));
}

export type ConfirmFromTextResult = { confirmed: boolean; showingId?: string };

/**
 * S750: confirm the renter's next viewing after a "yes" text. Picks the
 * soonest still-scheduled, unconfirmed viewing for this renter in this account
 * from an hour ago to 7 days out, and confirms only that one. Idempotent: an
 * already-confirmed viewing is never touched again.
 */
export async function confirmShowingFromText(
  client: ConfirmClient,
  input: { orgId: string; leadId: string; nowIso?: string },
): Promise<ConfirmFromTextResult> {
  const now = new Date(input.nowIso ?? new Date().toISOString()).getTime();
  const from = new Date(now - 60 * 60 * 1000).toISOString();
  const to = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("showings")
    .select("id, scheduled_at")
    .eq("organization_id", input.orgId)
    .eq("lead_id", input.leadId)
    .eq("outcome", "scheduled")
    .is("confirmed_at", null)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .order("scheduled_at", { ascending: true })
    .limit(1);
  const row = ((data ?? []) as { id: string }[])[0];
  if (!row) return { confirmed: false };

  const { data: updated } = await client
    .from("showings")
    .update({ confirmed_at: new Date(now).toISOString(), confirmed_by: "renter" })
    .eq("id", row.id)
    .eq("outcome", "scheduled")
    .is("confirmed_at", null)
    .select("id")
    .maybeSingle();
  if (!updated) return { confirmed: false };

  await client.from("messages").insert({
    organization_id: input.orgId,
    lead_id: input.leadId,
    channel: "note",
    direction: "inbound",
    body: "Renter confirmed their viewing by text",
  });
  return { confirmed: true, showingId: row.id };
}
