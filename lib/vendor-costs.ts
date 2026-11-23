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
};

export const VENDOR_COSTS: readonly VendorCost[] = [
  {
    job: "A booking page with automatic reminders",
    inVacantless: "Booking pages and reminders for every rental",
    typicalPrice: "US$10 a month",
    vendor: "Calendly Standard, per person, billed yearly",
    sourceUrl: "https://calendly.com/pricing",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "A local business number for texting renters",
    inVacantless: "Texts from your own local number, included in every paid plan",
    typicalPrice: "US$15 to US$19 a month",
    vendor: "Quo, formerly OpenPhone, Starter, per person",
    sourceUrl: "https://quo.com/pricing",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "Leases and applications signed online",
    inVacantless: "The Ontario Standard Lease, applications and offers signed online",
    typicalPrice: "CA$13 a month, 5 documents a month",
    vendor: "Docusign Personal, billed yearly",
    sourceUrl: "https://ecom.docusign.com/en-CA/isv/plans-and-pricing/esignature",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "Bookkeeping software",
    inVacantless: "Expenses, owner statements, your T776 summary and a zip for your accountant",
    typicalPrice: "CA$30 a month",
    vendor: "QuickBooks Online EasyStart, Canada",
    sourceUrl: "https://quickbooks.intuit.com/ca/pricing/",
    checkedOn: "2026-11-23",
    kind: "monthly",
  },
  {
    job: "Someone to post and update your ads",
    inVacantless: "Posting to Kijiji, Rentals.ca and Zumper, with the Posting add-on",
    typicalPrice: "US$10 to US$20 an hour",
    vendor: "A virtual assistant on Upwork, median rate",
    sourceUrl: "https://www.upwork.com/hire/virtual-assistants/cost/",
    checkedOn: "2026-11-23",
    kind: "per_job",
  },
  {
    job: "Having an LTB notice drafted",
    inVacantless: "N4, N5, N8, N12, L1 and more, filled from the tenancy",
    typicalPrice: "CA$150 to CA$350 a notice",
    vendor: "Ontario lawyer or paralegal, per a LawyerInfo guide",
    sourceUrl:
      "https://lawyerinfo.ca/guides/ontario/landlord-tenant-ontario/evictions-rent-disputes-ontario/lawyer-and-paralegal-fees-for-ltb-eviction-hearings-in-ontario/",
    checkedOn: "2026-11-23",
    kind: "per_job",
  },
  {
    job: "Brightening phone photos",
    inVacantless: "Photos from your Drive or Dropbox folder come in brighter, originals kept",
    typicalPrice: "US$2 a photo",
    vendor: "BoxBrownie Image Enhancement",
    sourceUrl: "https://www.boxbrownie.com/pricing",
    checkedOn: "2026-11-23",
    kind: "per_job",
  },
];

export const VENDOR_COSTS_HEAD = "What these jobs typically cost elsewhere";
export const VENDOR_COSTS_NOTE =
  "Typical list prices from each vendor's own page or a published guide, checked on the date shown. Your price may differ. Taxes extra.";

export function formatCheckedOn(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}
