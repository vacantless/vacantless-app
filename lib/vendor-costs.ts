// S832 (PLAN-S829 item 4b, Noam 2026-11-22 13:23): the "pays for itself"
// table. What a landlord would typically pay OTHER vendors for jobs Vacantless
// already does. Rules (Noam): every line names a Vacantless feature that truly
// does that job; every price is public, linked and dated; we say "typical
// price", never "you will save". No usage averages, no grand total (the lines
// mix currencies and monthly with per-job prices).
// Read by components/marketing/vendor-cost-table.tsx (homepage pricing and the
// billing page). Tested in scripts/test-s832-vendor-costs.ts. Re-check every
// price when its checkedOn date is a year old (the test warns at 180 days).

export type VendorCost = {
  /** The job, in the landlord's words. */
  job: string;
  /** What does it in Vacantless (a real, live feature). */
  inVacantless: string;
  /** The typical outside price, as shown, currency named. */
  typicalPrice: string;
  /** Who charges it, as named on the source. */
  vendor: string;
  sourceUrl: string;
  /** YYYY-MM-DD the price was read on the source. */
  checkedOn: string;
  /** monthly app, or a fee each time the job is done. */
  kind: "monthly" | "per_job";
  /** S832c: the price as numbers, in the vendor's own currency. */
  amount: { currency: "USD" | "CAD"; low: number; high?: number };
  /** S832d: what the price is per, shown after the Canadian-dollar price. */
  per: "a month" | "an hour" | "a notice" | "a photo";
  /** S832c: one worked example, unit price times a count the reader sees. */
  example?: { count: number; label: string };
};

/**
 * S832c: US prices shown in Canadian dollars at the Bank of Canada daily
 * rate, named with its date. Re-read it when the prices are re-checked.
 */
export const USD_CAD = {
  rate: 1.4325,
  date: "2026-11-20",
  sourceUrl: "https://www.bankofcanada.ca/rates/daily-digest/",
} as const;

export const VENDOR_COSTS: readonly VendorCost[] = [
  {
    job: "A booking page with automatic reminders",
    inVacantless: "Booking pages and reminders for every rental",
    typicalPrice: "US$10 a month",
    amount: { currency: "USD", low: 10 },
    per: "a month",
    vendor: "Calendly Standard, per person, billed yearly",
    sourceUrl: "https://calendly.com/pricing",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "A local business number for texting renters",
    inVacantless: "Texts from your own local number, included in every paid plan",
    typicalPrice: "US$15 to US$19 a month",
    amount: { currency: "USD", low: 15, high: 19 },
    per: "a month",
    vendor: "Quo, formerly OpenPhone, Starter, per person",
    sourceUrl: "https://quo.com/pricing",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "Leases and applications signed online",
    inVacantless: "The Ontario Standard Lease, applications and offers signed online",
    typicalPrice: "CA$13 a month, 5 documents a month",
    amount: { currency: "CAD", low: 13 },
    per: "a month",
    vendor: "Docusign Personal, billed yearly",
    sourceUrl: "https://ecom.docusign.com/en-CA/isv/plans-and-pricing/esignature",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "Bookkeeping software",
    inVacantless: "Expenses, owner statements, your T776 summary and a zip for your accountant",
    typicalPrice: "CA$30 a month",
    amount: { currency: "CAD", low: 30 },
    per: "a month",
    vendor: "QuickBooks Online EasyStart, Canada",
    sourceUrl: "https://quickbooks.intuit.com/ca/pricing/",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "Someone to post and update your ads",
    inVacantless: "Posting to Kijiji, Rentals.ca and Zumper, with the Posting add-on",
    typicalPrice: "US$10 to US$20 an hour",
    amount: { currency: "USD", low: 10, high: 20 },
    per: "an hour",
    vendor: "A virtual assistant on Upwork, median rate",
    sourceUrl: "https://www.upwork.com/hire/virtual-assistants/cost/",
    checkedOn: "2026-11-23",
    kind: "per_job",
  },
  {
    job: "Having an LTB notice drafted",
    inVacantless: "N4, N5, N8, N12, L1 and more, filled from the tenancy",
    typicalPrice: "CA$150 to CA$350 a notice",
    amount: { currency: "CAD", low: 150, high: 350 },
    per: "a notice",
    vendor: "Ontario lawyer or paralegal, per a LawyerInfo guide",
    sourceUrl:
      "https://lawyerinfo.ca/guides/ontario/landlord-tenant-ontario/evictions-rent-disputes-ontario/lawyer-and-paralegal-fees-for-ltb-eviction-hearings-in-ontario/",
    checkedOn: "2026-11-23",
    kind: "per_job",
  },
  {
    job: "Brightening phone photos",
    inVacantless: "Phone photos you upload or pull from a folder come in brighter, originals kept",
    typicalPrice: "US$2 a photo",
    amount: { currency: "USD", low: 2 },
    per: "a photo",
    example: { count: 20, label: "a 20-photo listing" },
    vendor: "BoxBrownie Image Enhancement",
    sourceUrl: "https://www.boxbrownie.com/pricing",
    checkedOn: "2026-11-23",
    kind: "per_job",
  },
];

export const VENDOR_COSTS_HEAD = "What these jobs typically cost elsewhere";
export const VENDOR_COSTS_NOTE =
  "Typical list prices from each vendor's own page or a published guide, checked on the date shown. Your price may differ. Taxes extra.";

/** Canadian dollars for an amount, converted at USD_CAD when it is in US dollars. */
export function toCad(value: number, currency: "USD" | "CAD"): number {
  return currency === "USD" ? value * USD_CAD.rate : value;
}

function cadText(n: number): string {
  return `CA$${Math.round(n)}`;
}

/** The line's price in Canadian dollars, e.g. "about CA$21 to CA$27". */
export function cadPriceText(v: VendorCost): string {
  const lo = toCad(v.amount.low, v.amount.currency);
  const hi = v.amount.high != null ? toCad(v.amount.high, v.amount.currency) : null;
  const range = hi != null && Math.round(hi) !== Math.round(lo) ? `${cadText(lo)} to ${cadText(hi)}` : cadText(lo);
  return `${v.amount.currency === "USD" ? "about " : ""}${range} ${v.per}`;
}

/** The worked example, e.g. "a 20-photo listing: about CA$57". */
export function exampleText(v: VendorCost): string | null {
  if (!v.example) return null;
  const total = toCad(v.amount.low * v.example.count, v.amount.currency);
  return `${v.example.label}: ${v.amount.currency === "USD" ? "about " : ""}${cadText(total)}`;
}

/** The monthly apps added up in Canadian dollars, low and high, rounded. */
export function monthlySubtotalCad(rows: readonly VendorCost[] = VENDOR_COSTS): { low: number; high: number } {
  let low = 0;
  let high = 0;
  for (const v of rows) {
    if (v.kind !== "monthly") continue;
    low += toCad(v.amount.low, v.amount.currency);
    high += toCad(v.amount.high ?? v.amount.low, v.amount.currency);
  }
  return { low: Math.round(low), high: Math.round(high) };
}

export function formatCheckedOn(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}
