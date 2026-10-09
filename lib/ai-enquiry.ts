// ai-enquiry.ts (S702). The pure half of the AI enquiry reader and the AI
// renter answer.
//
// Reader: we hand-built a reader per site (Kijiji, Zumper, Rentals.ca). Any
// other enquiry email a landlord forwards (Craigslist, liv.rent, a renter
// writing directly, a site we never saw) used to be dropped. The AI reads it
// instead: who is asking, how to reach them, what they asked, and which of the
// landlord's rentals it is about. Matching is done by the model against the
// landlord's own rental list, by id, and the id is checked against that list.
//
// Answer: the first reply to a renter answers the question they actually asked,
// from the rental's own facts only. If the facts do not answer it, no answer is
// given (the booking link still goes out). Nothing is ever invented.

export type EnquiryRental = {
  id: string;
  address: string;
  rentDollars: number | null;
  beds: number | null;
  title?: string | null;
};

export type EnquiryEmail = {
  subject: string;
  from: string;
  replyTo: string | null;
  body: string;
};

export type EnquiryRead = {
  isEnquiry: boolean;
  confidence: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  question: string | null;
  rentalId: string | null;
  site: string | null;
};

/** Words that mark a forwarded email as a rental enquiry worth reading. */
const ENQUIRY_WORDS = [
  "rent",
  "rental",
  "apartment",
  "available",
  "viewing",
  "showing",
  "lease",
  "inquiry",
  "enquiry",
  "interested",
  "bedroom",
  "unit",
  "listing",
  "tenant",
  "move in",
  "move-in",
  "voicemail",
  "missed call",
];

/** Cheap first filter so receipts and documents keep their own path. */
export function looksLikeEnquiryText(subject: string, body: string): boolean {
  const text = `${subject}\n${body.slice(0, 4000)}`.toLowerCase();
  let hits = 0;
  for (const w of ENQUIRY_WORDS) if (text.includes(w)) hits++;
  return hits >= 2;
}

export const ENQUIRY_SYSTEM_PROMPT = [
  "You read emails forwarded by a landlord and decide whether each is a renter asking about one of their rentals.",
  "Return only a JSON object. Never invent a name, email, phone or rental.",
  "Use null for anything the email does not state.",
  "The renter's email is the person asking, never a no-reply address and never the landlord's own address.",
  "A voicemail transcript or a missed call notice from a caller about a rental counts as an enquiry. The caller's number is the phone.",
].join(" ");

export function buildEnquiryPrompt(email: EnquiryEmail, rentals: EnquiryRental[]): string {
  const list = rentals
    .map(
      (r) =>
        `- id ${r.id}: ${r.address}${r.rentDollars ? `, $${r.rentDollars.toLocaleString("en-CA")}/month` : ""}${
          r.beds != null ? `, ${r.beds} bed` : ""
        }${r.title ? `, ad title "${r.title}"` : ""}`,
    )
    .join("\n");
  return [
    "The landlord's open rentals:",
    list || "(none listed)",
    "",
    "Return JSON with these keys:",
    '{"is_enquiry": true|false, "confidence": 0 to 1, "name": string|null, "email": string|null,',
    ' "phone": string|null, "question": string|null, "rental_id": one id from the list or null,',
    ' "site": the website the enquiry came from, or null}',
    "question is the renter's own words, shortened to one sentence. Pick rental_id only when the email clearly points to that rental by address, price, beds or ad title.",
    "",
    `Subject: ${email.subject.slice(0, 300)}`,
    `From: ${email.from.slice(0, 200)}`,
    `Reply-To: ${(email.replyTo ?? "").slice(0, 200)}`,
    "",
    email.body.slice(0, 8000),
  ].join("\n");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOREPLY_RE = /(^|[._-])no-?reply|donotreply|do-not-reply|mailer-daemon/i;

function cleanStr(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
}

export function normalizeEnquiryRead(
  raw: Record<string, unknown> | null,
  rentals: EnquiryRental[],
  blockedEmails: string[] = [],
): EnquiryRead | null {
  if (!raw) return null;
  const blocked = new Set(blockedEmails.map((e) => e.toLowerCase()));
  let email = cleanStr(raw.email)?.toLowerCase() ?? null;
  if (email && (!EMAIL_RE.test(email) || NOREPLY_RE.test(email) || blocked.has(email))) email = null;
  let phone = cleanStr(raw.phone, 40);
  if (phone && phone.replace(/\D/g, "").length < 10) phone = null;
  const ids = new Set(rentals.map((r) => r.id));
  const rentalIdRaw = cleanStr(raw.rental_id, 64);
  const rentalId = rentalIdRaw && ids.has(rentalIdRaw) ? rentalIdRaw : null;
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0;
  return {
    isEnquiry: raw.is_enquiry === true,
    confidence,
    name: cleanStr(raw.name, 120),
    email,
    phone,
    question: cleanStr(raw.question, 400),
    rentalId,
    site: cleanStr(raw.site, 60),
  };
}

/** Enough to file a lead: a real enquiry, sure enough, and a way to reach them. */
export function isFileableEnquiry(r: EnquiryRead | null, minConfidence = 0.7): r is EnquiryRead {
  return Boolean(r && r.isEnquiry && r.confidence >= minConfidence && (r.email || r.phone));
}

// ---------------------------------------------------------------------------
// Renter answer
// ---------------------------------------------------------------------------

export const ANSWER_SYSTEM_PROMPT = [
  "You answer a renter's question about a rental using ONLY the facts given.",
  "If the facts do not clearly answer it, reply with exactly NO_ANSWER.",
  "Never guess, never promise anything, never mention the facts list.",
  "Answer in one or two short plain sentences, under 40 words. No dashes used as punctuation.",
].join(" ");

/** Turn a public listing row into a plain facts list for the answer prompt. */
export function listingFacts(l: Record<string, unknown>): string {
  const lines: string[] = [];
  const add = (label: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "boolean") lines.push(`${label}: ${v ? "yes" : "no"}`);
    else lines.push(`${label}: ${String(v).slice(0, 600)}`);
  };
  add("Address", l.address);
  if (typeof l.rent_cents === "number") add("Rent per month", `$${Math.round(l.rent_cents / 100).toLocaleString("en-CA")}`);
  add("Bedrooms", l.beds);
  add("Bathrooms", l.baths);
  add("Square feet", l.sqft);
  add("Available from", l.available_date);
  add("Lease term", l.lease_term);
  add("Parking", l.parking);
  add("Laundry", l.laundry);
  add("Furnished", l.furnished);
  add("Balcony", l.balcony);
  add("Air conditioning", l.air_conditioning ?? l.ac_type);
  add("Heat included", l.heat_included);
  add("Hydro included", l.hydro_included);
  add("Water included", l.water_included);
  add("Smoking", l.smoking);
  if (l.pet_policy_set === true) {
    add("Cats allowed", l.pets_cats);
    add("Dogs allowed", l.pets_dogs);
    add("Dog size", l.pets_dog_size);
    add("Pet notes", l.pets_notes);
  }
  add("Description", l.description);
  return lines.join("\n");
}

export function buildAnswerPrompt(question: string, facts: string): string {
  return `Facts:\n${facts}\n\nRenter's question: ${question.slice(0, 500)}`;
}

/** Keep a usable answer; drop NO_ANSWER, links, and anything too long. */
export function usableAnswer(text: string | null): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, " ").replace(/—/g, ",");
  if (!t || /NO_ANSWER/i.test(t)) return null;
  if (/https?:\/\//i.test(t)) return null;
  if (t.split(" ").length > 50) return null;
  return t;
}

/** A question worth answering: not empty and not just "is it available?". */
export function worthAnswering(question: string | null | undefined): question is string {
  if (!question) return false;
  const q = question.trim().toLowerCase();
  if (q.length < 8) return false;
  if (/^(hi|hello|hey)?[\s,!.]*(is (this|it) )?(still )?available\??$/.test(q)) return false;
  return true;
}
