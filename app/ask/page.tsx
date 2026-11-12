import Link from "next/link";
import { MarketingCta, MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { ASK_PAGES, askPath } from "@/lib/ask-pages";

// S783: the landlord questions, one page each (lib/ask-pages.ts).

export const metadata = {
  title: "Ontario landlord questions, answered plainly | Vacantless",
  description:
    "Straight answers to what Ontario landlords ask most: N12 compensation, serving a notice, N4 timing, showings, deposits, rent increases, heat and tax deductions.",
  alternates: { canonical: "https://www.vacantless.com/ask" },
};

export default function AskIndexPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Ontario landlord questions
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              The questions landlords ask most, answered plainly.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Each answer is short, checked against the source, and dated.
            </p>
          </div>
        </section>
        <section className="py-10">
          <div className="mx-auto grid w-[min(1000px,calc(100%-32px))] gap-4 sm:grid-cols-2">
            {ASK_PAGES.map((p) => (
              <Link
                key={p.slug}
                href={askPath(p.slug)}
                className="rounded-2xl border border-[#d9e1dc] bg-white p-5 transition hover:border-[#16756a] hover:shadow-sm"
              >
                <h2 className="text-[1.1rem] font-extrabold tracking-tight">{p.question}</h2>
                <p className="mt-1.5 line-clamp-3 text-[0.95rem] leading-relaxed text-[#384a42]">{p.answer}</p>
                <p className="mt-3 text-[0.9rem] font-bold text-[#16756a]">Read the answer</p>
              </Link>
            ))}
          </div>
        </section>
        <MarketingCta
          title="Less time on the leasing part."
          body="Free for one rental. Vacantless is the leasing tool built by working landlords."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
