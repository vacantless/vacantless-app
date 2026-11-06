import { N4Tool } from "@/components/n4-tool";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
} from "../../../components/marketing-chrome";

// S755: the free Ontario Form N4 filler (engine 3 of the subscriber plan, after
// the rent-increase tool and the Standard Lease). No sign-in. The rules come from
// lib/n4.ts and lib/n12.ts, the fill from lib/n4-official-pdf.ts, the same code
// the signed-in N4 uses.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ontario Form N4 filler: the rent owing table and the right termination date",
  description:
    "Enter the rent and what was paid. Get the arrears table, the 7-day termination date (mail and courier counted) and the Landlord and Tenant Board's 2026 Form N4 filled in. Free, no sign-in.",
  alternates: { canonical: "https://www.vacantless.com/tools/n4" },
};

const RULES: { title: string; body: string }[] = [
  {
    title: "Rent only",
    body: "An N4 is for unpaid rent. Late fees, NSF charges, utilities you bill separately, damage and the last month's deposit stay off it.",
  },
  {
    title: "7 days of notice",
    body: "For notices given on or after September 21, 2026, the termination date can be 7 days after the notice is given, for every tenancy.",
  },
  {
    title: "Mail and courier take longer",
    body: "Mail counts as given 5 days after you send it. Courier counts the next business day. The tool adds that for you.",
  },
  {
    title: "Paying cancels it",
    body: "If the tenant pays everything owing by the termination date, the notice is void. Overstate the amount and the notice can be thrown out.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "When can I give an N4?",
    a: "From the day after the rent was due. For rent due on the 1st, that is the 2nd of the month.",
  },
  {
    q: "Is this the current form?",
    a: "Yes. It is the Landlord and Tenant Board's Form N4 (2026/09), issued with the 7-day rule. The Board stops accepting the older 2022 version after November 30, 2026.",
  },
  {
    q: "The tenant owes more than three months. Where does it go?",
    a: "The form has three rows. As the Board's instructions say, the earlier months share the first row and the latest month gets its own.",
  },
  {
    q: "What happens after the termination date?",
    a: "If the tenant has not paid in full or moved out, you can file an L1 application with the Landlord and Tenant Board. If they pay everything owing plus your filing fee before an eviction order is enforced, the case usually ends.",
  },
  {
    q: "Does this tool cover weekly rent or rent due on another day?",
    a: "Not yet. It covers monthly rent due on the 1st, which is most Ontario leases.",
  },
];

function todayInToronto(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function N4ToolPage() {
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
              Rent not paid? Fill the Form N4 in two minutes.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Enter the rent and what was paid. You get the rent owing table, the right
              termination date and the Board&apos;s current N4 ready to sign. No account needed.
            </p>
          </div>
        </section>

        <section className="py-10">
          <div className="mx-auto w-[min(1100px,calc(100%-32px))]">
            <N4Tool today={today} />
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
              <a
                className="underline hover:text-[#15211d]"
                href="https://tribunalsontario.ca/ltb/forms/"
                target="_blank"
                rel="noopener"
              >
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
          title="Fill your next vacancy the same easy way."
          body="Vacantless is the leasing tool built by working landlords. Renters book their own viewings, every inquiry lands in one list, and the Board forms are filled from the tenancy."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
