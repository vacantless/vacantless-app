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
  /** S724: the rental page where the renter books a time themselves. */
  bookingUrl?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** S724: "2026-11-01" reads "Nov 1" to a renter; anything else passes through. */
export function friendlyDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  return month && day >= 1 && day <= 31 ? `${month} ${day}` : v;
}

export type AiReplyDraft = {
  subject: string;
  body: string;
  slotOffer: string;
  suggestedQuestion: string | null;
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
      ? `available ${friendlyDate(cleanText(listing.availableDate))}`
      : null,
    laundryLabel(listing.laundry),
    listing.petFriendly === true ? "pet friendly" : null,
  ];

  return facts.filter((x): x is string => Boolean(x));
}

/** S726: "is this still available?" is a yes, not a move-in timing question. */
const STILL_AVAILABLE = /\b(?:still available|is (?:it|this|the (?:unit|place|apartment|rental)) available)\b/;

/** S726: the viewing window the renter named, if any ("I work evenings" is not one). */
export function preferredWindow(inquiryText: string | null | undefined): string | null {
  const lower = (cleanText(inquiryText) ?? "").toLowerCase();
  if (!lower) return null;
  if (/\b(weekend|weekends|saturday|sunday)\b/.test(lower)) return "weekend";
  if (/\bmornings?\b/.test(lower) && !/\bwork (?:in the )?mornings?\b/.test(lower)) return "morning";
  if (/\bafternoons?\b/.test(lower) && !/\bwork (?:in the )?afternoons?\b/.test(lower)) return "afternoon";
  if (/\b(evenings?|after work)\b/.test(lower) && !/\bwork (?:in the )?evenings?\b/.test(lower)) return "evening";
  return null;
}

function inquiryCue(inquiryText: string | null): string | null {
  const text = cleanText(inquiryText);
  if (!text) return null;

  const raw = text.toLowerCase();
  const stillAvailable = STILL_AVAILABLE.test(raw);
  const lower = raw.replace(STILL_AVAILABLE, " ");
  const yes = stillAvailable ? "Yes, it is still available." : null;
  const topic = topicCue(lower, Boolean(yes));
  return [yes, topic].filter(Boolean).join(" ") || null;
}

function topicCue(lower: string, saidYes: boolean): string | null {
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
  return saidYes ? null : "I read your note and can answer your questions before we book.";
}

export function suggestedCaptureQuestion(
  inquiryText: string | null | undefined,
): string | null {
  const text = cleanText(inquiryText);
  if (!text) return null;

  const lower = text.toLowerCase();
  if (/\bparking\b|\bspot\b|\bgarage\b/.test(lower)) {
    return "Is parking available?";
  }
  if (/\blaundry\b|\bwasher\b|\bdryer\b/.test(lower)) {
    return "Is laundry available?";
  }
  if (/\b(pet|pets|cat|cats|dog|dogs)\b/.test(lower)) {
    return "What is the pet policy?";
  }
  if (/\b(utilities|utility|heat|hydro|water)\b/.test(lower)) {
    return "Which utilities are included?";
  }
  if (/\bapply\b|\bapplication\b/.test(lower)) {
    return "How do I apply?";
  }
  if (
    /\b(view|viewing|showing|tour|see it|come by)\b/.test(lower) ||
    /\bmove.?in\b|\bavailable\b|\bavailability\b/.test(lower)
  ) {
    return null;
  }
  return null;
}

function sentence(value: string | null): string | null {
  const clean = cleanText(value);
  if (!clean) return null;
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

function slotOffer(input: AiReplyDraftInput): string {
  const window = preferredWindow(input.inquiryText);
  if (window) {
    return input.noSuitableTime
      ? `The open times did not suit you, so I will look for ${article(window)} ${window} time.`
      : `I will look for ${article(window)} ${window} viewing time for you.`;
  }
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
    ? `I also saw your desired move-in date: ${friendlyDate(cleanText(input.moveInDate))}.`
    : null;
  const bookingUrl = cleanText(input.bookingUrl);
  const knowledgeMatch = matchKnowledge(input.inquiryText, input.knowledge);
  const cue = knowledgeMatch
    ? sentence(knowledgeMatch.answerText)
    : inquiryCue(input.inquiryText);
  const suggestedQuestion = knowledgeMatch
    ? null
    : suggestedCaptureQuestion(input.inquiryText);
  const offer = slotOffer(input);

  const body = [
    `Hi ${firstName(input.renterName)},`,
    "",
    `Thanks for reaching out about ${place}. ${factSentence}`,
    cue,
    moveIn,
    offer,
    bookingUrl ? `You can also pick a time yourself here: ${bookingUrl}` : null,
    "",
    preferredWindow(input.inquiryText)
      ? bookingUrl
        ? "Or reply here, and I will confirm the time."
        : "I will reply here to confirm the time."
      : bookingUrl
        ? "Or reply with the window that works best, and I will confirm the next step."
        : "Please reply with the window that works best, and I will confirm the next step.",
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
    suggestedQuestion,
  };
}
