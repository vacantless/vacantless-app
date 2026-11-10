import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingCta, MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { FRICTION_PAGES, FIX_PATH, frictionPage } from "@/lib/friction-pages";
import { HOW_TO_PATH, HOW_TO_VIDEOS } from "@/lib/how-to-videos";

// S777: one page per landlord friction (lib/friction-pages.ts). The fix works
// with any tool; Vacantless comes second. Forum replies and YouTube link here.

export function generateStaticParams() {
  return FRICTION_PAGES.map((f) => ({ slug: f.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const f = frictionPage(params.slug);
  if (!f) return {};
  return {
    title: `${f.title} - how to fix it | Vacantless`,
    description: `${f.problem} ${f.fix.join(" ")}`,
    alternates: { canonical: `https://www.vacantless.com${FIX_PATH}/${f.slug}` },
  };
}

export default function FrictionPageView({ params }: { params: { slug: string } }) {
  const f = frictionPage(params.slug);
  if (!f) notFound();
  const video = f.video ? HOW_TO_VIDEOS.find((v) => v.n === f.video) ?? null : null;
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              <Link href={FIX_PATH} className="hover:underline">Landlord problems, fixed</Link>
            </p>
            <h1 className="mb-[18px] max-w-[24ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              {f.title}
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">{f.problem}</p>
          </div>
        </section>
        <section className="py-10">
          <div className="mx-auto grid w-[min(920px,calc(100%-32px))] gap-10">
            <div>
              <h2 className="text-[1.35rem] font-extrabold tracking-tight">The fix</h2>
              <p className="mt-1 text-[0.95rem] text-[#59655f]">Works with any tool, or none.</p>
              <ol className="mt-4 grid list-none gap-3 p-0">
                {f.fix.map((step, i) => (
                  <li key={step} className="flex items-start gap-3 rounded-xl border border-[#d9e1dc] bg-white p-4">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#edf5f0] text-[0.9rem] font-extrabold text-[#16756a]">
                      {i + 1}
                    </span>
                    <span className="text-[1rem] leading-relaxed text-[#273832]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="text-[1.35rem] font-extrabold tracking-tight">How Vacantless does it</h2>
              <ul className="mt-4 grid list-none gap-2.5 p-0">
                {f.how.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-[1rem] leading-snug text-[#273832]">
                    <span aria-hidden className="mt-1 text-[#16756a]">&#10003;</span>
                    {h}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.92rem] font-semibold text-[#59655f]">{f.plan}</p>
            </div>
            {video ? (
              <div>
                <h2 className="text-[1.35rem] font-extrabold tracking-tight">See it</h2>
                <video
                  className="mt-4 aspect-video w-full rounded-lg border border-[#d9e1dc] bg-[#edf5f0]"
                  src={`/videos/howto-${video.n}.mp4`}
                  poster={`/videos/howto-${video.n}.jpg`}
                  controls
                  preload="none"
                  playsInline
                />
                <p className="mt-2 text-[0.92rem] text-[#59655f]">
                  {video.title} ({video.seconds} s).{" "}
                  <Link href={`${HOW_TO_PATH}#video-${video.n}`} className="font-semibold text-[#15211d] underline">
                    All how-to videos
                  </Link>
                </p>
              </div>
            ) : null}
            <p className="text-[0.92rem] text-[#59655f]">
              Questions, or a problem we missed? Email{" "}
              <a href="mailto:hello@vacantless.com" className="font-semibold text-[#15211d] underline">
                hello@vacantless.com
              </a>
              .
            </p>
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
