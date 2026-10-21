import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-chrome";
import { VacantlessMark } from "../../components/vacantless-mark";
import { HOW_TO_VIDEOS } from "@/lib/how-to-videos";

// S726: the seven how-to videos (recorded on the S712 test account, captions
// only). Public, so the welcome email and the getting-started page can link
// here. Files live in public/videos (720p, about 1 to 2 MB each).
export const metadata = {
  title: "How-to videos - Vacantless",
  description:
    "Seven short videos: add a rental, set viewing times, answer an inquiry, post to rental sites, showing agents, after the viewing, and the little things that save you time.",
};



export default function HowToPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader active="howto" />
      <main className="mx-auto w-[min(1120px,calc(100%-32px))] py-12 sm:py-16">
        <p className="text-[0.8rem] font-extrabold uppercase tracking-[0.12em] text-[var(--color-accent-strong)]">How-to videos</p>
        <h1 className="mt-2 text-[clamp(1.9rem,4vw,2.6rem)] font-extrabold leading-tight tracking-tight">
          Seven short videos. About a minute each.
        </h1>
        <p className="mt-3 max-w-[40rem] text-[1.05rem] leading-relaxed text-[#384a42]">
          Each one walks a real screen in Vacantless with captions, so you can watch with the sound off.
        </p>
        <ol className="mt-10 grid list-none gap-8 p-0 sm:grid-cols-2">
          {HOW_TO_VIDEOS.map((v) => (
            <li key={v.n} id={`video-${v.n}`} className="scroll-mt-6">
              <video
                className="aspect-video w-full rounded-lg border border-[#d9e1dc] bg-[#edf5f0]"
                src={`/videos/howto-${v.n}.mp4`}
                poster={`/videos/howto-${v.n}.jpg`}
                controls
                preload="none"
                playsInline
              />
              <h2 className="mt-3 text-[1.1rem] font-bold">
                {v.n}. {v.title} <span className="text-[0.85rem] font-semibold text-[#59655f]">({v.seconds} s)</span>
              </h2>
              <p className="mt-1 text-[0.95rem] leading-relaxed text-[#59655f]">{v.line}</p>
            </li>
          ))}
        </ol>
        <p className="mt-12 text-[0.95rem] text-[#59655f]">
          Stuck on something else? Email{" "}
          <a href="mailto:hello@vacantless.com" className="font-semibold text-[#15211d] underline">
            hello@vacantless.com
          </a>{" "}
          and we will help.
        </p>
      </main>
    </div>
  );
}
