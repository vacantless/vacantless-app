export type CanonicalEmailEvent =
  | "delivered"
  | "bounced"
  | "blocked"
  | "spam"
  | "opened"
  | "other";

export type ParsedEmailTags = {
  kind: string | null;
  leadId: string | null;
  showingId: string | null;
};

export type EmailDeliveryEventLike = {
  event: string | null;
  occurred_at: string | null;
};

export function canonicalEvent(brevoEvent: string): CanonicalEmailEvent {
  const event = String(brevoEvent ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (event === "delivered") return "delivered";
  if (
    event === "hard_bounce" ||
    event === "soft_bounce" ||
    event === "bounce" ||
    event === "bounced"
  ) {
    return "bounced";
  }
  if (event === "blocked") return "blocked";
  if (event === "spam" || event === "complaint") return "spam";
  if (event === "opened" || event === "unique_opened" || event === "open") {
    return "opened";
  }
  return "other";
}

function cleanTagValue(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export function parseTags(tags: unknown): ParsedEmailTags {
  const result: ParsedEmailTags = { kind: null, leadId: null, showingId: null };
  const list =
    typeof tags === "string"
      ? [tags]
      : Array.isArray(tags)
        ? tags.filter((tag): tag is string => typeof tag === "string")
        : [];

  for (const raw of list) {
    const tag = raw.trim();
    const idx = tag.indexOf(":");
    if (idx <= 0) continue;
    const key = tag.slice(0, idx).trim().toLowerCase();
    const value = cleanTagValue(tag.slice(idx + 1));
    if (!value) continue;

    if (key === "kind" && result.kind == null) result.kind = value;
    else if (key === "lead" && result.leadId == null) result.leadId = value;
    else if (key === "showing" && result.showingId == null) result.showingId = value;
  }

  return result;
}

export function isUndeliverable(event: string | null): boolean {
  return event === "bounced" || event === "blocked" || event === "spam";
}

export function undeliverableSince(
  events: EmailDeliveryEventLike[],
  sinceIso: string | null,
): boolean {
  if (!sinceIso) return false;
  const sinceMs = new Date(sinceIso).getTime();
  if (!Number.isFinite(sinceMs)) return false;

  let latestUndeliverableMs: number | null = null;
  let latestDeliveredMs: number | null = null;

  for (const row of events) {
    const occurredMs = new Date(row.occurred_at ?? "").getTime();
    if (!Number.isFinite(occurredMs) || occurredMs < sinceMs) continue;

    if (row.event === "delivered") {
      latestDeliveredMs =
        latestDeliveredMs == null ? occurredMs : Math.max(latestDeliveredMs, occurredMs);
    } else if (isUndeliverable(row.event)) {
      latestUndeliverableMs =
        latestUndeliverableMs == null
          ? occurredMs
          : Math.max(latestUndeliverableMs, occurredMs);
    }
  }

  return (
    latestUndeliverableMs != null &&
    (latestDeliveredMs == null || latestDeliveredMs < latestUndeliverableMs)
  );
}
