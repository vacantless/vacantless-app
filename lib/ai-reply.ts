import { matchKnowledge, type PropertyQaEntry } from "./property-qa";

export type AiReplyListing = {
  address: string | null;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  parking?: string | null;
  availableDate?: string | null;
  laundry?: string | null;
  petFriendly?: boolean | null;
};

export type AiReplyDraftInput = {
  renterName: string | null;
  orgName: string;
  inquiryText: string | null;
  moveInDate?: string | null;
  noSuitableTime?: boolean | null;
  listing: AiReplyListing | null;
  knowledge?: readonly PropertyQaEntry[] | null;
};

export type AiReplyDraft = {
  subject: string;
  body: string;
  slotOffer: string;
};

export function aiReplyEnabled(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function cleanText(value: string | null | undefined): string | null {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 0 ? clean : null;
}

function firstName(value: string | null): string {
  return cleanText(value)?.split(/\s+/)[0] ?? "there";
}

function money(cents: number | null): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return null;
  }
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}/month`;
}

function bedsBaths(listing: AiReplyListing): string | null {
  const parts: string[] = [];
  if (typeof listing.beds === "number" && Number.isFinite(listing.beds)) {
    parts.push(`${listing.beds} bed${listing.beds === 1 ? "" : "s"}`);
  }
  if (typeof listing.baths === "number" && Number.isFinite(listing.baths)) {
    parts.push(`${listing.baths} bath${listing.baths === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function laundryLabel(value: string | null | undefined): string | null {
  switch (cleanText(value)) {
    case "in_suite":
      return "in-suite laundry";
    case "in_building":
      return "in-building laundry";
    case "shared":
      return "shared laundry";
    case "none":
      return "no laundry";
    default:
      return null;
  }
}

function listingFacts(listing: AiReplyListing | null): string[] {
  if (!listing) return [];

  const facts = [
    money(listing.rentCents),
    bedsBaths(listing),
    cleanText(listing.parking) ? `parking: ${cleanText(listing.parking)}` : null,
    cleanText(listing.availableDate)
      ? `available ${cleanText(listing.availableDate)}`
      : null,
    laundryLabel(listing.laundry),
    listing.petFriendly === true ? "pet friendly" : null,
  ];

  return facts.filter((x): x is string => Boolean(x));
}

function inquiryCue(inquiryText: string | null): string | null {
  const text = cleanText(inquiryText);
  if (!text) return null;

  const lower = text.toLowerCase();
  if (/\b(pet|pets|cat|cats|dog|dogs)\b/.test(lower)) {
    return "I noticed your pet question and can confirm the pet details before we book.";
  }
  if (/\bparking\b|\bspot\b|\bgarage\b/.test(lower)) {
    return "I noticed your parking question and can confirm the parking details before we book.";
  }
  if (/\blaundry\b|\bwasher\b|\bdryer\b/.test(lower)) {
    return "I noticed your laundry question and can confirm those details before we book.";
  }
  if (/\bmove.?in\b|\bavailable\b|\bavailability\b/.test(lower)) {
    return "I noticed your timing question and can line things up around your move-in window.";
  }
  if (/\bapply\b|\bapplication\b|\bcredit\b/.test(lower)) {
    return "I can also answer application questions after we confirm whether the unit is a fit.";
  }
  return "I read your note and can answer your questions before we book.";
}

function sentence(value: string | null): string | null {
  const clean = cleanText(value);
  if (!clean) return null;
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function slotOffer(input: AiReplyDraftInput): string {
  if (input.noSuitableTime) {
    return "I can offer another viewing slot. Would a weekday evening, weekend, or daytime window work better for you?";
  }

  const text = cleanText(input.inquiryText)?.toLowerCase() ?? "";
  if (/\b(view|viewing|showing|tour|see it|come by)\b/.test(text)) {
    return "I can offer a viewing slot next. Would a weekday evening, weekend, or daytime window work for you?";
  }

  return "If you are still interested, I can offer a viewing slot. Would a weekday evening, weekend, or daytime window work for you?";
}

export function buildAiReplyDraft(input: AiReplyDraftInput): AiReplyDraft {
  const place = cleanText(input.listing?.address) ?? "the rental";
  const orgName = cleanText(input.orgName) ?? "Vacantless";
  const facts = listingFacts(input.listing);
  const factSentence =
    facts.length > 0
      ? `A few listing details: ${facts.join("; ")}.`
      : "I can help with the details and next steps.";
  const moveIn = cleanText(input.moveInDate)
    ? `I also saw your desired move-in date: ${cleanText(input.moveInDate)}.`
    : null;
  const knowledgeMatch = matchKnowledge(input.inquiryText, input.knowledge);
  const cue = knowledgeMatch
    ? sentence(knowledgeMatch.answerText)
    : inquiryCue(input.inquiryText);
  const offer = slotOffer(input);

  const body = [
    `Hi ${firstName(input.renterName)},`,
    "",
    `Thanks for reaching out about ${place}. ${factSentence}`,
    cue,
    moveIn,
    offer,
    "",
    "Please reply with the window that works best, and I will confirm the next step.",
    "",
    "Thanks,",
    orgName,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    subject: `Re: your inquiry about ${place}`,
    body,
    slotOffer: offer,
  };
}
