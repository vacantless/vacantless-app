import { N8Tool } from "@/components/n8-tool";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
} from "../../../components/marketing-chrome";

// S757: the free Ontario Form N8 filler (persistent late rent). No sign-in. The
// rules come from lib/n8.ts (O. Reg. 516/06 s. 8.1, counting rent due on or after
// 2026-09-21), the fill from lib/n8-official-pdf.ts, the same code the signed-in N8 uses.

export const dynamic = "force-dynamic";

export const metadata = {
  title: 'Ontario Form N8 filler: persistent late rent under the 3-in-6 rule',
  description:
    "Rent keeps coming in late? Check the 3 times in 6 months rule, list the late payments and get the Board's 2026 Form N8 filled in with the 60-day termination date. Free, no sign-in.",
  alternates: { canonical: "https://www.vacantless.com/tools/n8" },
};

const RULES: { title: string; body: string }[] = [
  {
    title: "3 times in 6 months",
    body: "Since September 21, 2026, a tenant who paid the rent more than 7 days late at least 3 times in any 6 months counts as persistently late. The Board can also find persistent late payment in other cases."
  },
  {
    title: "Which late payments count",
    body: "The tool counts rent that came due on or after September 21, 2026, the day the rule began, so the first notice it can fill is after the December 2026 rent is more than 7 days late. Earlier late payments are listed as history."
  },
  {
    title: "60 days, to the end of a month",
    body: "The termination date must be at least 60 days after the notice counts as given, and the last day of a rental period. In a fixed term, it is the last day of the term."
  },
  {
    title: "Paying does not cancel it",
    body: "Unlike an N4, the tenant can't cancel an N8 by paying. If they stay past the termination date, you can file an L2 application, and the Board decides."
  }
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What counts as late?",
    a: "Rent paid in full more than 7 days after the day it was due. For rent due on the 1st, rent paid on the 9th or later counts."
  },
  {
    q: "Why can't I count late payments from the summer?",
    a: "The 3-in-6 rule began on September 21, 2026 and says nothing about earlier payments, so the tool counts only rent due after that day. You can still describe earlier late payments, and a paralegal can tell you whether they help your case."
  },
  {
    q: "Is this the current form?",
    a: "Yes. It is the Landlord and Tenant Board's Form N8 (2026/09), filled for persistent late payment of rent."
  },
  {
    q: "The rent is still not paid. Is this the right form?",
    a: "No. For rent that is owed now, use an N4 (Notice to End a Tenancy Early for Non-payment of Rent)."
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

export default function N8ToolPage() {
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
              Rent always late? Check the 3-in-6 rule and fill the Form N8.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Enter the day each month&apos;s rent came in. You see which late payments count, the earliest end date and the Board&apos;s current N8 with the late payments listed. No account needed.
            </p>
          </div>
        </section>

        <section className="py-10">
          <div className="mx-auto w-[min(1100px,calc(100%-32px))]">
            <N8Tool today={today} />
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
              Sources: Landlord and Tenant Board,{" "}
              <a className="underline hover:text-[#15211d]" href="https://tribunalsontario.ca/ltb/forms/" target="_blank" rel="noopener">
                Forms
              </a>
              ; Ontario Regulation 516/06, s. 8.1, added by{" "}
              <a className="underline hover:text-[#15211d]" href="https://www.ontario.ca/laws/regulation/r26241" target="_blank" rel="noopener">
                O. Reg. 241/26
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
          title="Keep the rent record and the paperwork in one place."
          body="Vacantless is the leasing tool built by working landlords. Renters book their own viewings, every inquiry lands in one list, and the Board forms are filled from the tenancy."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
