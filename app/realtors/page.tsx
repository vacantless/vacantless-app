import { LEASING_PROOF_STATS } from "@/lib/proof-stats";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
  ProofStats,
} from "../../components/marketing-chrome";

// S722: page for realtors who lease their clients' rentals. Every step is a live
// feature: PDF drop / paste prefill (add-property-form.tsx), the rental page and
// booking (/r), showing agents (/agent/[token], no login), Posting add-on.

export const metadata = {
  title: "Vacantless for realtors - lease your clients' rentals without phone tag",
  description:
    "Drop the MLS data sheet, share one link in every rental ad, and let renters book their own viewings. Hand viewings to a showing agent with one link. Free for one rental.",
};

const STEPS: { title: string; body: string }[] = [
  {
    title: "Drop the data sheet",
    body: "Choose Copy from an existing ad, then drop the MLS data sheet PDF or paste the listing text from realtor.ca. Address, rent, beds, baths, size and description fill in. Add the photos and check it.",
  },
  {
    title: "Share one link in every ad",
    body: "MLS reaches agents. Renters are on Facebook Marketplace, Kijiji, Rentals.ca and Zumper. Put the rental page link in each ad, and every renter lands in one list.",
  },
  {
    title: "Renters book themselves",
    body: "Each renter gets an email reply within seconds with a link to book a time in the hours you set, an Add to calendar link, a reminder the day before and a one-tap cancel link.",
  },
  {
    title: "Hand off the viewing",
    body: "Send viewings to a showing agent. They get one link with every viewing, the address, the access notes and the renter's number, and confirm with a tap. No login.",
  },
];

const FOR_YOU: string[] = [
  "An email the moment a renter asks or books.",
  "Every renter for every listing in one list, with their answers and notes.",
  "Your name and colours on every page and email renters see.",
  "With the CA$49 a month Posting add-on, we post to Kijiji, Rentals.ca and Zumper for you, on your own accounts. Kijiji charges its own fee for each ad.",
];

export default function RealtorsPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader active="realtors" />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-12 pt-16">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              For realtors who lease
            </p>
            <h1 className="mb-[18px] max-w-[20ch] text-[clamp(2.1rem,4.4vw,3.2rem)] font-extrabold leading-[1.05] tracking-tight">
              Lease your clients&apos; rentals without the phone tag.
            </h1>
            <p className="max-w-[56ch] text-[clamp(1.04rem,1.6vw,1.2rem)] leading-relaxed text-[#384a42]">
              Your owner expects the unit marketed like a landlord would, on the sites renters
              use, and every enquiry answered. Vacantless runs the renter side so you can spend
              your time on the showings and the lease.
            </p>
          </div>
        </section>

        <section className="py-14">
          <div className="mx-auto w-[min(1000px,calc(100%-32px))]">
            <h2 className="mb-6 text-[1.5rem] font-extrabold tracking-tight">How it works</h2>
            <ol className="grid list-none gap-4 p-0 md:grid-cols-2">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-lg border border-[#d9e1dc] bg-white p-[22px]">
                  <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e4f4ed] text-[0.9rem] font-extrabold text-[#16756a]">
                    {i + 1}
                  </span>
                  <h3 className="mb-1.5 text-[1.05rem] font-bold">{s.title}</h3>
                  <p className="text-[0.92rem] leading-relaxed text-[#59655f]">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y border-[#d9e1dc] bg-[#f4f7f5] py-14">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-4 text-[1.5rem] font-extrabold tracking-tight">What you get</h2>
            <ul className="grid list-none gap-3 p-0">
              {FOR_YOU.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-base text-[#273832]">
                  <span className="mt-[5px] h-4 w-4 flex-none rounded bg-[#1f8a5b]" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-[64ch] leading-relaxed text-[#384a42]">
              Free for one rental. CA$99 a month for as many listings as you carry. Billed monthly,
              cancel anytime.
            </p>
          </div>
        </section>

        <section className="py-14">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-1 text-[1.5rem] font-extrabold tracking-tight">
              Built by a working landlord and realtor
            </h2>
            <p className="max-w-[64ch] leading-relaxed text-[#384a42]">
              Vacantless has run the leasing for a real rental portfolio in Windsor, Ontario, since
              May 2026.
            </p>
            <ProofStats stats={LEASING_PROOF_STATS} />
          </div>
        </section>

        <MarketingCta
          title="Try it on your next lease listing."
          body="Free for one rental. No card to start."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
