// The one copy of the founder-rental proof figures shown on the home and About
// pages (S710 audit: they were typed twice). Counted from the database on
// 2026-10-09 for Agile Real Estate Group: 258 renter enquiries (all leads, the
// first on 2026-05-08) and 107 viewings (the first on 2026-06-26), 89 of the 107
// booked by the renter on the listing page. S710 re-check: leads since
// 2026-06-26 are only 210, so the page says "since May", not "since June".
// Update them from the database, never from memory.
export const LEASING_PROOF_STATS: readonly { value: string; label: string }[] = [
  { value: "258", label: "renter inquiries, all in one list." },
  { value: "107", label: "viewings booked." },
  { value: "8 in 10", label: "viewings booked by the renter, with no phone tag." },
];

// S734: the one proof line under the Posting offer (rental page, Sign in to
// your sites). Counted from the database on 2026-10-23 for Agile Real Estate
// Group: 276 leads, 113 showings. Update from the database, never from memory.
export const POSTING_OFFER_PROOF =
  "Our first customer has five rentals in Windsor. 276 renter inquiries and 113 viewings, all in one list. Counted 2026-10-23.";
