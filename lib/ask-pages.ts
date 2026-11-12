// S783: landlord questions, one page each, in the words landlords search with.
// Questions come from what landlords ask in Ontario landlord groups and forums
// (claude/GROWTH-POST-TRACKER.md, claude/RESEARCH-S775-LANDLORD-FRICTION.md);
// the wording is the question only, never anyone's post. Each answer is plain,
// Ontario-only and checked against an official or legal source on the date in
// CHECKED. Recheck every page when the law or a yearly number changes (the rent
// guideline each summer; Bill 60 changed N4 and N12 on 2026-09-21). The answer
// comes first; Vacantless is a related link, never the answer.

export type AskSource = { label: string; url: string };

export type AskPage = {
  slug: string;
  /** The question as a landlord types it. */
  question: string;
  /** The answer in two or three short sentences. Shown first and in search. */
  answer: string;
  /** What else to know, one short point each. */
  details: string[];
  /** Where it was checked. */
  sources: AskSource[];
  /** A free tool or fix page that does the work, if any. */
  related?: { href: string; label: string };
};

export const ASK_PATH = "/ask";
export const ASK_CHECKED = "2026-11-12";

const LTB_SERVE: AskSource = {
  label: "Landlord and Tenant Board: How to serve documents",
  url: "https://tribunalsontario.ca/documents/ltb/Brochures/How%20to%20Serve%20a%20Landlord%20or%20Tenant%20with%20Documents%20(EN).html",
};
const LTB_GUIDE: AskSource = {
  label: "Landlord and Tenant Board: A Guide to the Residential Tenancies Act",
  url: "https://tribunalsontario.ca/documents/ltb/Brochures/Guide%20to%20RTA%20(English).html",
};
const BILL_60: AskSource = {
  label: "Gowling WLG: Ontario's new Landlord and Tenant Board rules (2026)",
  url: "https://gowlingwlg.com/en/insights-resources/articles/2026/ontario-new-ltb-rules",
};
const RENT_INCREASES: AskSource = {
  label: "Ontario.ca: Residential rent increases",
  url: "https://www.ontario.ca/page/residential-rent-increases",
};

export const ASK_PAGES: AskPage[] = [
  {
    slug: "do-i-have-to-pay-n12-compensation",
    question: "Do I have to pay one month's rent when I give an N12?",
    answer:
      "Not always. Since September 21, 2026, own-use notices with at least 120 days' notice owe nothing. Otherwise, or for a buyer, you pay one month's rent by the end date.",
    details: [
      "The 120 days count from the day the notice counts as given.",
      "Mail adds 5 days. Courier adds one business day.",
      "The end date must be the last day of a rental period or term.",
      "Instead of the money, you can offer another unit the tenant accepts.",
      "Pay it as its own e-transfer or cheque, marked as N12 compensation.",
      "A company cannot give an N12 for its own use. The landlord must be a person.",
      "Whoever moves in must plan to live there for at least a year.",
    ],
    sources: [BILL_60, { label: "Landlord and Tenant Board: forms and instructions", url: "https://tribunalsontario.ca/ltb/forms/" }],
    related: { href: "/tools/n12", label: "Fill in an N12 for free, dates checked" },
  },
  {
    slug: "tenant-refuses-to-accept-notice",
    question: "My tenant won't accept a notice. How do I serve it?",
    answer:
      "You don't need their cooperation. Leave it in their mailbox, slide it under the door, or mail it. Each of these is a proper way to serve.",
    details: [
      "Handing it over or leaving it in the mailbox counts the same day.",
      "Regular mail counts on the fifth day after you mail it.",
      "Courier counts the next day.",
      "You can also give it to an adult in the unit.",
      "Email only works if the tenant agreed to it in writing.",
      "Taping it to the door is not on the Board's list. Use the mailbox or door slot.",
      "Take a photo, note the time, and fill in a Certificate of Service.",
    ],
    sources: [LTB_SERVE],
    related: { href: "/tools", label: "Free Ontario notice tools" },
  },
  {
    slug: "when-can-i-give-an-n4",
    question: "When can I give an N4 for unpaid rent?",
    answer:
      "The day after the rent was due and not paid. Since September 21, 2026, the end date can be 7 days after service.",
    details: [
      "The 7 days now apply to monthly tenancies too. It used to be 14.",
      "Mail adds 5 days. Courier adds one business day.",
      "If the tenant pays everything owed before the end date, the notice is void.",
      "If they don't pay, you can apply to the Board with an L1.",
      "A quick call before the notice often gets the rent paid faster.",
    ],
    sources: [BILL_60, LTB_SERVE],
    related: { href: "/tools/n4", label: "Fill in an N4 for free, dates worked out" },
  },
  {
    slug: "can-i-show-the-unit-to-new-renters",
    question: "Can I enter my rental to show it to new renters?",
    answer:
      "Yes, once either side gives notice, or you both agree the tenancy ends. Show it between 8 a.m. and 8 p.m. Make a real effort to tell the tenant first.",
    details: [
      "You don't need 24 hours' written notice for these showings.",
      "Before anyone gives notice, you can't show it to new renters.",
      "Showing a buyer or an insurer needs 24 hours' written notice.",
      "That notice states the reason, the day, and a time between 8 a.m. and 8 p.m.",
      "A short window, like two hours, is fairer than all day.",
      "Book several renters into one time, so the tenant is bothered once.",
    ],
    sources: [
      {
        label: "Landlord and Tenant Board: Interpretation Guideline 19, right of entry",
        url: "https://tribunalsontario.ca/documents/ltb/Interpretation%20Guidelines/19%20-%20The%20Landlords%20Right%20of%20Entry%20into%20a%20Rental%20Unit.html",
      },
    ],
    related: { href: "/fix/no-shows", label: "Group viewings and fewer no-shows" },
  },
  {
    slug: "interest-on-last-months-rent",
    question: "Do I have to pay interest on last month's rent deposit?",
    answer:
      "Yes, every year, at the rent increase guideline. That is 2.1% for interest due in 2026 and 1.9% for 2027.",
    details: [
      "On a $2,000 deposit, 1.9% is $38 for the year.",
      "When you raise the rent, the interest can top up the deposit.",
      "If the interest is more than the top-up, pay the tenant the difference.",
      "The deposit can't be more than one month's rent.",
      "It can only pay the last month. It can never cover damage.",
    ],
    sources: [LTB_GUIDE, RENT_INCREASES],
    related: { href: "/tools/rent-increase", label: "Free rent increase calculator" },
  },
  {
    slug: "what-deposits-can-a-landlord-charge",
    question: "What deposits can a landlord charge in Ontario?",
    answer:
      "Only two. A last month's rent deposit, up to one month's rent. And a refundable key deposit. Damage, pet and cleaning deposits are not allowed.",
    details: [
      "The key deposit can't be more than the cost of replacing the key.",
      "Return the key deposit when the keys come back.",
      "Ask for the rent deposit on or before the day you sign the lease.",
      "If a tenant damages the unit, you apply to the Board to recover it.",
      "Photos at move-in and move-out make that much easier.",
    ],
    sources: [
      LTB_GUIDE,
      {
        label: "City of Toronto: renter rights and landlord information",
        url: "https://www.toronto.ca/community-people/housing-shelter/rental-housing-tenant-information/renter-rights-landlord-information/",
      },
    ],
    related: { href: "/tools/standard-lease", label: "Fill in the Ontario Standard Lease for free" },
  },
  {
    slug: "can-i-require-post-dated-cheques",
    question: "Can I require post-dated cheques or automatic rent payments?",
    answer:
      "No. You can suggest them, and many tenants agree. You can't require them or turn down a renter who says no.",
    details: [
      "Rent is due in full on the day it's due.",
      "Give a receipt for rent when the tenant asks.",
      "Offer an easy way to pay, like e-transfer.",
      "A friendly reminder a few days early prevents most late payments.",
    ],
    sources: [
      LTB_GUIDE,
      {
        label: "Landlord and Tenant Board: Information for New Tenants",
        url: "https://tribunalsontario.ca/documents/ltb/Brochures/Information%20for%20New%20Tenants.pdf",
      },
    ],
    related: { href: "/fix/late-rent", label: "Late rent, fixed" },
  },
  {
    slug: "ontario-rent-increase-2027",
    question: "How much can I raise the rent in Ontario in 2027?",
    answer:
      "1.9% for most units, for increases that start in 2027. It was 2.1% in 2026.",
    details: [
      "On $2,000 a month, 1.9% is $38, so the new rent is $2,038.",
      "Give 90 days' written notice on the Board's form, usually an N1.",
      "At least 12 months must pass since the last increase or move-in.",
      "Units first lived in after November 15, 2018 are not capped by the guideline.",
      "Those units still need 90 days' notice and 12 months between increases.",
    ],
    sources: [RENT_INCREASES],
    related: { href: "/tools/rent-increase", label: "Free rent increase calculator" },
  },
  {
    slug: "what-temperature-must-a-rental-be",
    question: "What temperature do I have to keep my rental at?",
    answer:
      "If you supply the heat, at least 20°C from September 1 to June 15. Many cities ask for more, so check your local bylaw.",
    details: [
      "Toronto asks for 21°C from September 15 to June 1.",
      "Windsor asks for 21°C from September 1 to June 15.",
      "Where the city number is higher, the city number applies.",
      "The provincial rule differs when the tenant controls the heat and it reaches 20°C.",
      "Tenant says it's too hot? Have the system checked once.",
      "Then talk it through. A thermostat the tenant can set solves most of these.",
    ],
    sources: [
      {
        label: "Landlord and Tenant Board: Maintenance and Repairs",
        url: "https://tribunalsontario.ca/documents/ltb/Brochures/Maintenance%20and%20Repairs.html",
      },
      { label: "Ontario Regulation 517/06, Maintenance Standards, section 15", url: "https://www.ontario.ca/laws/regulation/060517" },
    ],
    related: { href: "/fix/repairs-and-emergencies", label: "Repairs without phone tag" },
  },
  {
    slug: "what-rental-expenses-can-i-deduct",
    question: "What rental property expenses can I deduct on my taxes?",
    answer:
      "Reasonable costs you pay to earn the rent. You list them on Form T776 with your tax return.",
    details: [
      "Common ones: advertising, insurance, property tax and mortgage interest.",
      "Also repairs, utilities you pay, management fees, and legal and accounting fees.",
      "Mortgage interest counts. The principal does not.",
      "A repair that restores something is deducted this year.",
      "An improvement that lasts is claimed over several years instead.",
      "Keep receipts in one place, sorted by the T776 lines.",
      "Accountants charge less when the year is already sorted.",
    ],
    sources: [
      { label: "Canada Revenue Agency: Guide T4036, Rental Income", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4036/rental-income.html" },
    ],
    related: { href: "/fix/tax-time", label: "Tax time, fixed" },
  },
];

export function askPage(slug: string | null | undefined): AskPage | null {
  return ASK_PAGES.find((p) => p.slug === slug) ?? null;
}

export function askPath(slug: string): string {
  return `${ASK_PATH}/${slug}`;
}

/** schema.org FAQPage for one page, so search can show the answer. */
export function askJsonLd(p: AskPage): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: p.question,
        acceptedAnswer: { "@type": "Answer", text: [p.answer, ...p.details].join(" ") },
      },
    ],
  };
}
