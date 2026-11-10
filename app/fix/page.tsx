import Link from "next/link";
import { MarketingCta, MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { FRICTION_PAGES, frictionPath } from "@/lib/friction-pages";

// S777: every landlord friction we fix, one page each (lib/friction-pages.ts).

export const metadata = {
  title: "Landlord problems, fixed: no-shows, repairs, late rent and more | Vacantless",
  description:
    "The problems landlords raise most, each with a fix that works with any tool: no-shows, endless messages, repairs, late rent, rent increases, tax time and Board notices.",
  alternates: { canonical: "https://www.vacantless.com/fix" },
};

export default function FixIndexPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Landlord problems, fixed
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              The problems landlords talk about most.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Each page has a fix that works with any tool, then how Vacantless does it.
            </p>
          </div>
        </section>
        <section className="py-10">
          <div className="mx-auto grid w-[min(1000px,calc(100%-32px))] gap-4 sm:grid-cols-2">
            {FRICTION_PAGES.map((f) => (
              <Link
                key={f.slug}
                href={frictionPath(f.slug)}
                className="rounded-2xl border border-[#d9e1dc] bg-white p-5 transition hover:border-[#16756a] hover:shadow-sm"
              >
                <h2 className="text-[1.15rem] font-extrabold tracking-tight">{f.title}</h2>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-[#384a42]">{f.problem}</p>
                <p className="mt-3 text-[0.9rem] font-bold text-[#16756a]">See the fix</p>
              </Link>
            ))}
          </div>
        </section>
        <MarketingCta
          title="Try it on your next vacancy."
          body="Free for one rental. Vacantless is the leasing tool built by working landlords."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
