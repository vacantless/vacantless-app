// S740 (review item 4): ONE set of founder-rental proof figures for every
// page. The home page showed 258 / 107 / "8 in 10" in the hero and 276 / 112 /
// "nearly 9 in 10" in the Posting block. Counted from the database on
// 2026-11-05 (S752) for Agile Real Estate Group: 289 leads (the first
// 2026-05-08), 116 renters with a viewing, 101 of the 116 booked within an
// hour of their first inquiry (87%). The "9 in 10" is of renters who BOOKED,
// not of all inquiries; every label says so (S752, outside review). Update
// PROOF only, from the database, never from memory; everything below reads
// from it.
export const PROOF = {
  inquiries: 289,
  viewings: 116,
  withinHour: "Nearly 9 in 10",
  countedOn: "2026-11-05",
} as const;

export const LEASING_PROOF_STATS: readonly { value: string; label: string }[] = [
  { value: String(PROOF.inquiries), label: "renter inquiries, all in one list." },
  { value: String(PROOF.viewings), label: "renters booked a viewing." },
  { value: PROOF.withinHour, label: "of renters who booked did it within an hour of asking." },
];

// The one proof line under the Posting offer (rental page, Sign in to your sites).
export const POSTING_OFFER_PROOF = `Our first customer has five rentals in Windsor. ${PROOF.inquiries} renter inquiries and ${PROOF.viewings} renters booked a viewing, all in one list. Counted ${PROOF.countedOn}.`;

// S737 (review item 12): the proof under the Posting card on the pricing
// section. Counted from the database on 2026-10-25 for Agile Real Estate
// Group: 16 ads on Kijiji, Rentals.ca and Zumper posted by us (listing_posts
// live, removed or expired); 276 leads, 112 renters with a viewing; 97 of the
// 112 booked within an hour of their first inquiry (86.6%, "nearly 9 in 10").
// Update from the database, never from memory. Every figure must stay true.
export const POSTING_PROOF = {
  title: "What Posting does for our first customer",
  lines: [
    "Five rentals in Windsor.",
    "We posted 16 ads to Kijiji, Rentals.ca and Zumper for them.",
    "We check them daily and tell you when a site drops one.",
    "Nobody retyped an ad.",
  ],
  statValue: PROOF.withinHour,
  statLabel: "of renters who booked did it within an hour of asking.",
  footnote:
    `${PROOF.inquiries} renter inquiries and ${PROOF.viewings} renters with a booked viewing since May. Counted ${PROOF.countedOn} from rentals the founder runs. Your own results will vary.`,
};
