import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingCta, MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { ASK_CHECKED, ASK_PAGES, ASK_PATH, askJsonLd, askPage } from "@/lib/ask-pages";

// S783: one landlord question per page (lib/ask-pages.ts). The answer comes
// first, in the words a landlord searches with; sources and the check date
// follow; Vacantless is a related link, never the answer.

export function generateStaticParams() {
  return ASK_PAGES.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const p = askPage(params.slug);
  if (!p) return {};
  return {
    title: `${p.question} | Ontario landlord questions | Vacantless`,
    description: p.answer,
    alternates: { canonical: `https://www.vacantless.com${ASK_PATH}/${p.slug}` },
  };
}

function checkedLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function AskPageView({ params }: { params: { slug: string } }) {
  const p = askPage(params.slug);
  if (!p) notFound();
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(askJsonLd(p)).replace(/</g, "\\u003c") }} />
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              <Link href={ASK_PATH} className="hover:underline">Ontario landlord questions</Link>
            </p>
            <h1 className="mb-[18px] max-w-[26ch] text-[clamp(1.9rem,4vw,2.8rem)] font-extrabold leading-[1.08] tracking-tight">
              {p.question}
            </h1>
            <div className="max-w-[62ch] rounded-2xl border border-[#cfe3d8] bg-white p-5">
              <p className="text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">Short answer</p>
              <p className="mt-2 text-[clamp(1.05rem,1.5vw,1.18rem)] leading-relaxed text-[#273832]">{p.answer}</p>
            </div>
          </div>
        </section>
        <section className="py-10">
          <div className="mx-auto grid w-[min(920px,calc(100%-32px))] gap-10">
            <div>
              <h2 className="text-[1.35rem] font-extrabold tracking-tight">What else to know</h2>
              <ul className="mt-4 grid list-none gap-2.5 p-0">
                {p.details.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-[1rem] leading-relaxed text-[#273832]">
                    <span aria-hidden className="mt-1 text-[#16756a]">&#10003;</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
            {p.related ? (
              <div className="rounded-2xl border border-[#d9e1dc] bg-[#f6faf8] p-5">
                <Link href={p.related.href} className="text-[1.05rem] font-extrabold text-[#15211d] underline">
                  {p.related.label}
                </Link>
              </div>
            ) : null}
            <div>
              <h2 className="text-[1.1rem] font-extrabold tracking-tight">Where this comes from</h2>
              <ul className="mt-3 grid list-none gap-1.5 p-0 text-[0.95rem]">
                {p.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} className="text-[#15211d] underline" rel="noopener">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.9rem] text-[#59655f]">
                Checked {checkedLabel(ASK_CHECKED)}. Ontario rules. General information, not legal or tax advice.
              </p>
            </div>
            <p className="text-[0.92rem] text-[#59655f]">
              Spot something out of date? Email{" "}
              <a href="mailto:hello@vacantless.com" className="font-semibold text-[#15211d] underline">
                hello@vacantless.com
              </a>
              .
            </p>
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
