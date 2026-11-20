// S823c: "Offer times to a renter". The landlord hand-picks 1 to 3 viewing
// times for one renter; the renter taps one and it is booked. No calendar is
// shown to anyone (a realtor does not want an open or an empty calendar on
// display). Pure helpers only; the writes live in the server action and in
// migration 0312 (accept_viewing_offer).

export const MAX_VIEWING_OFFER_SLOTS = 3;

/** Future, distinct, soonest-first ISO times, capped at three. */
export function normalizeOfferSlots(
  values: Iterable<Date | string | null | undefined>,
  now: Date = new Date(),
): string[] {
  const seen = new Set<number>();
  for (const raw of values) {
    if (raw == null || raw === "") continue;
    const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
    if (Number.isNaN(ms) || ms <= now.getTime()) continue;
    seen.add(ms);
  }
  return Array.from(seen)
    .sort((a, b) => a - b)
    .slice(0, MAX_VIEWING_OFFER_SLOTS)
    .map((ms) => new Date(ms).toISOString());
}

/** The offered times that are still ahead. */
export function futureOfferSlots(value: unknown, now: Date = new Date()): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeOfferSlots(
    value.filter((v): v is string => typeof v === "string"),
    now,
  );
}

function first(name: string | null | undefined): string {
  return (name?.trim() || "").split(/\s+/)[0] || "there";
}

/**
 * The message a landlord pastes into whatever chat or email the renter wrote
 * from (Realtor.ca reply, Messenger, a text). Plain text, no dashes.
 */
export function offerReplyText(input: {
  renterName: string | null | undefined;
  address: string | null | undefined;
  whenLabels: readonly string[];
  url: string;
}): string {
  const place = input.address?.trim() || "the rental";
  const lines = [`Hi ${first(input.renterName)},`, ""];
  if (input.whenLabels.length === 1) {
    lines.push(`I can show you ${place} on ${input.whenLabels[0]}.`);
    lines.push("");
    lines.push(`Tap here to confirm it: ${input.url}`);
  } else {
    lines.push(`I can show you ${place} at one of these times:`);
    for (const label of input.whenLabels) lines.push(`  ${label}`);
    lines.push("");
    lines.push(`Tap here and pick the one that works. It is booked right away: ${input.url}`);
  }
  lines.push("");
  lines.push("If none of them work, tell me what does and I will send new times.");
  return lines.join("\n");
}

/** Maps accept_viewing_offer's reason to the public page's status. */
export function offerStatusForReason(reason: string | null | undefined): string {
  if (reason === "not_found" || reason === "slot_not_proposed") return "invalid";
  if (reason === "taken") return "taken";
  if (reason === "past") return "past";
  if (reason === "not_pending" || reason === "expired" || reason === "listing_unavailable") {
    return "expired";
  }
  return "error";
}

/** Result banners on the renter's page in the dashboard. */
export const OFFER_TIMES_MESSAGES: Record<string, string> = {
  sent: "Times sent to the renter by email. The first one they tap is booked.",
  saved: "Times saved. Copy the message below and send it to the renter.",
  send_failed: "Times saved, but the email did not go out. Copy the message below and send it yourself.",
  withdrawn: "Those times are withdrawn. The renter's link no longer works.",
  no_time: "Pick at least one date and time.",
  past: "Those times have passed. Pick times later today or after.",
  no_rental: "This renter is not linked to a rental yet.",
  forbidden: "You don't have permission to book viewings.",
  error: "Something went wrong. Please try again.",
};

export function offerTimesTone(code: string): "good" | "warn" {
  return code === "sent" || code === "saved" || code === "withdrawn" ? "good" : "warn";
}
