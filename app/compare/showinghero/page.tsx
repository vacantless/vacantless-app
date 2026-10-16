import { LEASING_PROOF_STATS } from "@/lib/proof-stats";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
  ProofStats,
} from "../../../components/marketing-chrome";

// S722: plain comparison with ShowingHero. Every Vacantless line is a claim the
// live product keeps (same wording as the home page and Billing). Every
// ShowingHero line is from showinghero.com/pricing, read 2026-10-15. Re-read
// their page before changing their column; never state what their page does not.
const SHOWINGHERO_CHECKED = "October 15, 2026";

export const metadata = {
  title: "Vacantless vs ShowingHero - for landlords under 300 units",
  description:
    "ShowingHero's published plans start at 300 units or 25 listings, in US dollars. Vacantless is free for one rental and CA$99 a month for as many as you have, built in Canada for Kijiji, Rentals.ca and Zumper.",
};

type Row = { topic: string; us: string; them: string };

const COMPARE_ROWS: Row[] = [
  {
    topic: "Who it is for",
    us: "Landlords and agents of any size, starting with one rental.",
    them: "Portfolios with at least 300 units, or at least 25 active listings.",
  },
  {
    topic: "Price",
    us: "Free for one rental. CA$99 a month for as many rentals as you have.",
    them: "US$1.50 per unit a month with a 300-unit minimum (US$450 a month), or US$20 per active listing a month with a 25-listing minimum (US$500 a month).",
  },
  {
    topic: "Currency",
    us: "Canadian dollars.",
    them: "US dollars.",
  },
  {
    topic: "Renters book their own viewing",
    us: "Yes, into the hours you set.",
    them: "Yes.",
  },
  {
    topic: "Every renter answered",
    us: "Yes. An email reply within seconds, with a link to book.",
    them: "Yes.",
  },
  {
    topic: "Reminders",
    us: "Email confirmation, an Add to calendar link, a reminder the day before and a one-tap cancel link.",
    them: "Yes, as part of showing automation.",
  },
  {
    topic: "Self-guided tours",
    us: "No. A person shows the unit.",
    them: "Yes.",
  },
  {
    topic: "Rental sites",
    us: "Your Facebook Page, free. Kijiji, Rentals.ca and Zumper with the CA$49 a month Posting add-on, on your own accounts. Kijiji charges its own fee for each ad.",
    them: "25+ listing sites.",
  },
  {
    topic: "Texting renters",
    us: "Not yet. Renters hear from you by email.",
    them: "Not stated on their pricing page.",
  },
  {
    topic: "Contract",
    us: "Billed monthly. Change or cancel anytime, no contract.",
    them: "Not stated on their pricing page.",
  },
];

export default function CompareShowingHeroPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader active="compare" />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-12 pt-16">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Vacantless vs ShowingHero
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2.1rem,4.4vw,3.2rem)] font-extrabold leading-[1.05] tracking-tight">
              ShowingHero is built for big portfolios. Vacantless is built for everyone else.
            </h1>
            <p className="max-w-[56ch] text-[clamp(1.04rem,1.6vw,1.2rem)] leading-relaxed text-[#384a42]">
              ShowingHero&apos;s published plans start at 300 units or 25 listings, billed in US
              dollars. Vacantless starts with one rental, free, and is CA$99 a month for as many
              as you have. It is built in Canada, for the sites Canadian renters use.
            </p>
          </div>
        </section>

        <section className="py-14">
          <div className="mx-auto w-[min(1000px,calc(100%-32px))]">
            {/* Table on wide screens, stacked cards on phones. */}
            <div className="hidden overflow-hidden rounded-lg border border-[#d9e1dc] md:block">
              <table className="w-full border-collapse text-left text-[0.92rem]">
                <thead className="bg-[#f4f7f5] text-[#15211d]">
                  <tr>
                    <th className="w-[22%] px-4 py-3 font-bold"> </th>
                    <th className="w-[39%] px-4 py-3 font-extrabold">Vacantless</th>
                    <th className="w-[39%] px-4 py-3 font-extrabold">ShowingHero</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((r) => (
                    <tr key={r.topic} className="border-t border-[#d9e1dc] align-top">
                      <th className="px-4 py-3 font-bold text-[#273832]">{r.topic}</th>
                      <td className="px-4 py-3 leading-snug text-[#15211d]">{r.us}</td>
                      <td className="px-4 py-3 leading-snug text-[#59655f]">{r.them}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              {COMPARE_ROWS.map((r) => (
                <div key={r.topic} className="rounded-lg border border-[#d9e1dc] p-4">
                  <p className="mb-2 font-extrabold">{r.topic}</p>
                  <p className="text-[0.9rem] leading-snug">
                    <b>Vacantless:</b> {r.us}
                  </p>
                  <p className="mt-1.5 text-[0.9rem] leading-snug text-[#59655f]">
                    <b>ShowingHero:</b> {r.them}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-[#59655f]">
              ShowingHero prices and features are as published on showinghero.com/pricing, read{" "}
              {SHOWINGHERO_CHECKED}. ShowingHero is a trademark of its owner. Vacantless is not
              affiliated with ShowingHero.
            </p>
          </div>
        </section>

        <section className="border-y border-[#d9e1dc] bg-[#f4f7f5] py-14">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-3 text-[1.5rem] font-extrabold tracking-tight">Which one fits you</h2>
            <p className="mb-4 max-w-[64ch] leading-relaxed text-[#384a42]">
              If you manage hundreds of units, want self-guided tours, or need a long list of US
              listing sites, ShowingHero is built for that.
            </p>
            <p className="max-w-[64ch] leading-relaxed text-[#384a42]">
              If you have one rental or a few buildings in Canada and want every renter answered
              and booked without phone tag, start here. Try it on one rental, free, with no card.
            </p>
          </div>
        </section>

        <section className="py-14">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-1 text-[1.5rem] font-extrabold tracking-tight">
              Run on our own rentals first
            </h2>
            <p className="max-w-[64ch] leading-relaxed text-[#384a42]">
              Vacantless has run the leasing for a real rental portfolio in Windsor, Ontario, since May 2026.
            </p>
            <ProofStats stats={LEASING_PROOF_STATS} />
          </div>
        </section>

        <MarketingCta
          title="See it on your own rental."
          body="Free for one rental. CA$99 a month for as many as you need. No card to start."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
