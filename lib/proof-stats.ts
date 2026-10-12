// The one copy of the founder-rental proof figures shown on the home and About
// pages (S710 audit: they were typed twice). Counted from the database on
// 2026-10-09 for Agile Real Estate Group: 258 renter enquiries (all leads, the
// first on 2026-05-08) and 107 viewings (the first on 2026-06-26), 89 of the 107
// booked by the renter on the listing page. S710 re-check: leads since
// 2026-06-26 are only 210, so the page says "since May", not "since June".
// Update them from the database, never from memory.
export const LEASING_PROOF_STATS: readonly { value: string; label: string }[] = [
  { value: "258", label: "renter enquiries, all in one list." },
  { value: "107", label: "viewings booked." },
  { value: "8 in 10", label: "viewings booked by the renter, with no phone tag." },
];
