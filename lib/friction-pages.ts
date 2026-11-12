// S777: one page per landlord friction (claude.ai doc "Vacantless friction
// marketing plan"; frictions from claude/RESEARCH-S775-LANDLORD-FRICTION.md).
// Each page: the problem in a landlord's words, a fix that works with or
// without Vacantless, how Vacantless does it, the plan, and a video. Forum
// replies, YouTube descriptions and outreach link here, never the homepage.
// Every "how" line was checked against the code on 2026-11-10
// (claude/AUDIT-S777-MARKETING-COVERAGE.md). A video is a how-to from
// lib/how-to-videos until its friction video is filmed; null = no video yet.

export type FrictionPage = {
  slug: string;
  /** The problem as a landlord would search it. */
  title: string;
  /** One line under the title, in a landlord's words. */
  problem: string;
  /** Three steps that work with any tool, or none. */
  fix: [string, string, string];
  /** How Vacantless does it, one short line each. */
  how: string[];
  /** Where it is included. */
  plan: string;
  /** How-to video number, or null when none shows it yet. */
  video: number | null;
  /** S779: this friction's own video (public/videos/fix-<slug>.mp4 and .jpg),
   * shown instead of the how-to. youtube = the video id on @getvacantless, or
   * null until it is uploaded. */
  film?: { seconds: number; youtube: string | null };
};

export const FIX_PATH = "/fix";

export const FRICTION_PAGES: FrictionPage[] = [
  {
    slug: "no-shows",
    title: "Renters not showing up for viewings",
    problem: "Half the people who book never come, and you drove there anyway.",
    fix: [
      "Ask every renter to confirm the day before, by text if you can.",
      "No answer by the morning? Give the time back to someone else.",
      "Book several renters into one time, so one no-show costs you nothing.",
    ],
    how: [
      "A reminder the day before. Renters reply YES to confirm.",
      "One tap nudges anyone who has not confirmed.",
      "Unconfirmed times open up again after the hours you choose.",
      "Group viewings: several renters at one time.",
    ],
    plan: "Free. Texts from your own number on any paid plan.",
    video: 6,
    film: { seconds: 51, youtube: "60u389nYmjE" },
  },
  {
    slug: "is-this-still-available",
    title: "Too many \"is this still available?\" messages",
    problem: "Two hundred messages on one ad, and most never write back.",
    fix: [
      "Answer everyone fast with the same short reply.",
      "Put the rent, the move-in date and a booking link in it.",
      "Spend your time on the renters who book.",
    ],
    how: [
      "Every message gets a reply with your booking link in seconds.",
      "Renters from every site land in one list.",
      "Quick replies on your phone for the chats you answer yourself.",
      "A free Chrome helper fills replies in Facebook Marketplace chats.",
    ],
    plan: "Free.",
    video: 3,
    film: { seconds: 38, youtube: "KLXuBpDyggw" },
  },
  {
    slug: "unqualified-renters",
    title: "Showing the unit to renters who aren't ready",
    problem: "Their lease ends in four months. Or they have three dogs, and you said no pets.",
    fix: [
      "Ask the move-in date, pets and household size before you give a time.",
      "Only let renters who fit pick a viewing time.",
      "Keep the others on file for the next unit.",
    ],
    how: [
      "Questions before booking: move-in date, pets, household, income.",
      "Renters who want to move in too late can't book themselves.",
      "A waiting list for renters who fit later.",
    ],
    plan: "Free. The waiting list is on any paid plan.",
    video: 3,
    film: { seconds: 36, youtube: "DANVe3KNRP0" },
  },
  {
    slug: "repairs-and-emergencies",
    title: "Repairs, contractors and 2 a.m. calls",
    problem: "Phone tag between the tenant, the trade and you, and texts at all hours.",
    fix: [
      "Give tenants one way to report, with photos and when they are home.",
      "Ask if it is an emergency first, and show the shut-off right there.",
      "Let the trade confirm the visit with the tenant directly.",
    ],
    how: [
      "The tenant's repair link asks first if it is an emergency.",
      "A real emergency reaches your phone at once, any hour.",
      "Your trade accepts, quotes and books from a link.",
      "See trades other landlords near you rated.",
      "A unit that keeps reporting the same thing is flagged.",
    ],
    plan: "Any paid plan, from CA$29 a month.",
    video: 10,
    film: { seconds: 45, youtube: "jEIfxcyiOU4" },
  },
  {
    slug: "showing-trips",
    title: "Driving across town for every showing",
    problem: "One showing breaks up the whole day.",
    fix: [
      "Pick two viewing windows a week and only show then.",
      "Book renters back to back, or several at once.",
      "Hand the showings to someone who lives nearby.",
    ],
    how: [
      "Renters book themselves inside the hours you set.",
      "Group viewings: several renters at one time.",
      "Showing agents get the bookings on their own phone page.",
    ],
    plan: "Free.",
    video: 5,
  },
  {
    slug: "posting-everywhere",
    title: "Posting the same ad on every site",
    problem: "The same ad typed three times. Old ads still get calls after it rents.",
    fix: [
      "Keep one master ad and copy from it.",
      "Change the price everywhere the day you change it.",
      "Take every ad down the day the unit rents.",
    ],
    how: [
      "We post to Kijiji, Rentals.ca and Zumper on your own accounts.",
      "Change the rent, dates or photos and your live ads update.",
      "A site ended your ad early? We post it again.",
      "Rented? The ads come down.",
    ],
    plan: "Free for one rental. Every rental with Posting, CA$49 a month. Kijiji charges its own ad fee.",
    video: 4,
    film: { seconds: 39, youtube: "QAaUbTm_voM" },
  },
  {
    slug: "late-rent",
    title: "Rent that comes in late, or not at all",
    problem: "Chasing e-transfers every month, and not sure how to serve an N4.",
    fix: [
      "Set up pre-authorized debit, so rent comes in on the 1st.",
      "When it does not, serve the right notice with the right dates.",
      "Keep a record of every payment and every notice.",
    ],
    how: [
      "Rent by pre-authorized debit through your own Stripe or Rotessa account.",
      "A free N4 for unpaid rent and N8 for rent that is always late.",
      "On Growth, the Ontario Board forms fill from your tenant's details.",
    ],
    plan: "The N4 and N8 tools are free. Rent collection is on any paid plan.",
    video: 9,
  },
  {
    slug: "rent-increase",
    title: "Missing the window for a rent increase",
    problem: "Miss the 90-day notice and you wait another year.",
    fix: [
      "Track the date of each tenant's last increase.",
      "Wait at least 12 months between increases.",
      "Serve the N1 at least 90 days before the new rent starts.",
    ],
    how: [
      "A free calculator fills the N1 with this year's guideline.",
      "On Growth, we email you before the last day to serve.",
    ],
    plan: "The calculator is free. Reminders are on any paid plan.",
    video: 9,
  },
  {
    slug: "tax-time",
    title: "A shoebox of receipts at tax time",
    problem: "Every spring, a weekend of matching the bank by hand.",
    fix: [
      "Record each cost when it clears the bank, not in April.",
      "Tag each cost to its building.",
      "Then the T776 is a copy job.",
    ],
    how: [
      "Costs come in from your bank, a bank file, repairs, or typed in.",
      "One owner statement per building.",
      "Your T776 summary and one zip for your accountant.",
    ],
    plan: "Any paid plan, from CA$29 a month.",
    video: 10,
  },
  {
    slug: "water-heater",
    title: "A water heater that fails without warning",
    problem: "It was 11 years old, and nobody noticed until it flooded the unit.",
    fix: [
      "List each unit's water heater and furnace with the year it went in.",
      "Most tank water heaters last about 10 to 12 years.",
      "Replace them on your schedule, not at 2 a.m.",
    ],
    how: [
      "Keep each unit's appliances and equipment in one place.",
      "You get a reminder as each one nears the end of its life.",
    ],
    plan: "Every account with a tenant.",
    video: null,
  },
  {
    slug: "scam-copies",
    title: "Scammers copying your rental ad",
    problem: "A fake ad with your photos, at a lower rent, taking renters' deposits.",
    fix: [
      "Search your cover photo every week or two while the ad is up.",
      "Check Kijiji and Marketplace a little under your price.",
      "Say in your ad that you take no money before a viewing.",
    ],
    how: [
      "One click opens a search of your cover photo.",
      "It also opens Kijiji and Marketplace searches near your price.",
      "We do not search the sites for you. Their rules do not allow it.",
    ],
    plan: "Free.",
    video: null,
  },
  {
    slug: "ltb-forms",
    title: "Board notices thrown out for a mistake",
    problem: "A wrong date voids the notice, and you start again months later.",
    fix: [
      "Use the Board's current form.",
      "Count the days with the rules for that notice.",
      "Keep proof of how and when you served it.",
    ],
    how: [
      "Free tools fill the N4, N8, N12 and N1 and check the dates.",
      "On Growth, the other Board forms fill from your tenant's details.",
    ],
    plan: "The tools are free, no sign-up.",
    video: 9,
  },
];

export function frictionPage(slug: string | null | undefined): FrictionPage | null {
  return FRICTION_PAGES.find((f) => f.slug === slug) ?? null;
}

export function frictionPath(slug: string): string {
  return `${FIX_PATH}/${slug}`;
}
