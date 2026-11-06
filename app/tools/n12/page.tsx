import { N12Tool } from "@/components/n12-tool";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
} from "../../../components/marketing-chrome";

// S757: the free Ontario Form N12 filler (own use or a buyer). No sign-in. The
// rules come from lib/n12.ts and lib/n12-snapshot.ts, the fill from
// lib/n12-official-pdf.ts, the same code the signed-in N12 uses.

export const dynamic = "force-dynamic";

export const metadata = {
  title: 'Ontario Form N12 filler: the right termination date and compensation',
  description:
    "Need the unit for yourself, your family or a buyer? Get the earliest valid N12 termination date, whether one month's rent is owed (the 120-day rule) and the Board's 2026 Form N12 filled in. Free, no sign-in.",
  alternates: { canonical: "https://www.vacantless.com/tools/n12" },
};

const RULES: { title: string; body: string }[] = [
  {
    title: "60 days, to the end of a month",
    body: "The termination date must be at least 60 days after the notice counts as given, and the last day of a rental period. For rent due on the 1st, that is the last day of a month. In a fixed term, it can't be before the term ends."
  },
  {
    title: "One month's rent, unless 120 days",
    body: "You must pay the tenant one month's rent by the termination date. For your own use, if the termination date is at least 120 days after the notice counts as given, no compensation is owed (notices given on or after September 21, 2026)."
  },
  {
    title: "A buyer always pays",
    body: "When the buyer or their family will move in, one month's rent is always owed. The sale must be agreed and the building can have no more than 3 residential units."
  },
  {
    title: "A person, not a company",
    body: "Only a landlord who is a person can end a tenancy for their own use. The person moving in must mean to live there for at least a year."
  }
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Who counts as family?",
    a: "You, your spouse, your child or parent, or your spouse's child or parent. Also someone who will give care to one of them and live in the same building."
  },
  {
    q: "Is this the current form?",
    a: "Yes. It is the Landlord and Tenant Board's Form N12 (2026/10), issued with the September 2026 changes."
  },
  {
    q: "Does mail change the date?",
    a: "Yes. Mail counts as given 5 days after you send it and courier the next business day, so the earliest end date can move a month. The tool adds that for you."
  },
  {
    q: "What happens after I give it?",
    a: "If the tenant does not move out by the termination date, you can file an L2 application with the Landlord and Tenant Board, with a declaration from the person moving in."
  },
  {
    q: "What if no one moves in?",
    a: "Giving an N12 in bad faith can lead to large fines and an order to pay the tenant. Only give it if the person really will move in."
  }
];

function todayInToronto(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function N12ToolPage() {
  const today = todayInToronto();
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Free tool for Ontario landlords
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              Need the unit back? Fill the Form N12 the right way.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Tell us who will move in and when you give the notice. You get the earliest valid end date, whether you owe one month&apos;s rent and the Board&apos;s current N12 ready to sign. No account needed.
            </p>
          </div>
        </section>

        <section className="py-10">
          <div className="mx-auto w-[min(1100px,calc(100%-32px))]">
            <N12Tool today={today} />
          </div>
        </section>

        <section className="border-t border-[#d9e1dc] bg-[#f6faf7] py-12">
          <div className="mx-auto w-[min(1000px,calc(100%-32px))]">
            <h2 className="mb-6 text-[1.5rem] font-extrabold tracking-tight">The rules the tool applies</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {RULES.map((r) => (
                <div key={r.title} className="rounded-xl border border-[#d9e1dc] bg-white p-5">
                  <h3 className="mb-1.5 text-[1.02rem] font-extrabold">{r.title}</h3>
                  <p className="text-[0.95rem] leading-relaxed text-[#384a42]">{r.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[0.82rem] text-[#59655f]">
              Source: Landlord and Tenant Board,{" "}
              <a className="underline hover:text-[#15211d]" href="https://tribunalsontario.ca/ltb/forms/" target="_blank" rel="noopener">
                Forms
              </a>
              .
            </p>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-6 text-[1.5rem] font-extrabold tracking-tight">Common questions</h2>
            <dl className="grid gap-5">
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt className="text-[1.02rem] font-extrabold">{f.q}</dt>
                  <dd className="mt-1 text-[0.95rem] leading-relaxed text-[#384a42]">{f.a}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[0.86rem] text-[#59655f]">
              This page explains the rules in plain words and fills a government form from the
              numbers you enter. It is not legal advice. For a dispute, talk to the Landlord and
              Tenant Board or a paralegal.
            </p>
          </div>
        </section>

        <MarketingCta
          title="Keep every tenancy and notice in one place."
          body="Vacantless is the leasing tool built by working landlords. Renters book their own viewings, every inquiry lands in one list, and the Board forms are filled from the tenancy."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
