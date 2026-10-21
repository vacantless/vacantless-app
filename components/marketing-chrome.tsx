import Link from "next/link";
import { OPERATOR_LINE } from "@/lib/operator-line";
import { VacantlessMark } from "./vacantless-mark";

// S722: header and footer for the newer public marketing pages
// (/compare/showinghero, /realtors). Same look as /about.

export const CONTACT_HREF = "mailto:hello@vacantless.com";
export const SIGNUP_LABEL = "Start free";

// S729: the ONE public-site header (home, about, how-to, compare, realtors).
// Every marketing page links to every other one from the top, and on a phone
// the links sit behind a Menu button (no JS: a <details> element).
export const MARKETING_LINKS: Array<{ key: string; href: string; label: string }> = [
  { key: "how", href: "/#how", label: "How it works" },
  { key: "pricing", href: "/#pricing", label: "Plans" },
  { key: "howto", href: "/how-to", label: "How-to videos" },
  { key: "compare", href: "/compare/showinghero", label: "Vs ShowingHero" },
  { key: "realtors", href: "/realtors", label: "For realtors" },
  { key: "about", href: "/about", label: "About" },
];

export type MarketingKey = "about" | "realtors" | "compare" | "howto" | "home";

export function MarketingHeader({ active }: { active?: MarketingKey }) {
  const cls = (k: string) =>
    active === k ? "text-[#15211d]" : "hover:text-[#15211d]";
  return (
    <header className="sticky top-0 z-20 border-b border-[#d9e1dc]/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between gap-3 py-3.5">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <VacantlessMark variant="black" className="h-[30px] w-[30px]" />
          <span className="text-[1.02rem] font-bold tracking-tight text-[#15211d]">
            Vacantless
          </span>
        </Link>
        <nav
          className="hidden items-center gap-[18px] text-[0.91rem] font-semibold text-[#59655f] lg:flex"
          aria-label="Marketing sections"
        >
          {MARKETING_LINKS.map((l) => (
            <Link key={l.key} href={l.href} className={cls(l.key)} aria-current={active === l.key ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-shrink-0 items-center gap-2">
          <details className="group relative lg:hidden">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center rounded-lg border border-[#d5ddd9] bg-white px-3 text-[0.86rem] font-bold text-[#17362f] [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[220px] rounded-xl border border-[#d9e1dc] bg-white p-2 shadow-[0_12px_30px_rgba(21,33,29,0.14)]">
              {MARKETING_LINKS.map((l) => (
                <Link
                  key={l.key}
                  href={l.href}
                  className={`block rounded-lg px-3 py-2.5 text-[0.95rem] font-semibold ${active === l.key ? "bg-[#f4f7f5] text-[#15211d]" : "text-[#203029] hover:bg-[#f4f7f5]"}`}
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/login"
                className="block rounded-lg px-3 py-2.5 text-[0.95rem] font-semibold text-[#203029] hover:bg-[#f4f7f5] sm:hidden"
              >
                Log in
              </Link>
            </div>
          </details>
          <Link
            href="/login"
            className="hidden min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-[#d5ddd9] bg-white px-[18px] text-[0.92rem] font-bold text-[#17362f] transition hover:bg-[#f4f7f5] sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            aria-label="Start free with one rental"
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-[#17362f] bg-[#17362f] px-3 text-[0.86rem] font-bold text-white shadow-[0_8px_18px_rgba(23,54,47,0.18)] transition hover:bg-[#1f463c] sm:px-[18px] sm:text-[0.92rem]"
          >
            {SIGNUP_LABEL}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingCta({ title, body }: { title: string; body: string }) {
  return (
    <section className="bg-gradient-to-br from-[#17362f] to-[#1f4a3f] text-white">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-5 py-14 md:grid-cols-[1fr_auto]">
        <div>
          <h2 className="max-w-[22ch] text-[clamp(1.7rem,3.2vw,2.4rem)] font-extrabold leading-[1.08]">
            {title}
          </h2>
          <p className="mt-2.5 text-[#cfe0d8]">{body}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg bg-white px-[18px] text-[0.92rem] font-bold text-[#17362f] transition hover:bg-[#eef4f1]"
          >
            {SIGNUP_LABEL}
          </Link>
          <a
            href={CONTACT_HREF}
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-white/40 px-[18px] text-[0.92rem] font-bold text-white transition hover:bg-white/10"
          >
            Talk to our team
          </a>
        </div>
      </div>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#d9e1dc] py-8 text-[0.86rem] text-[#59655f]">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <VacantlessMark variant="black" className="h-[30px] w-[30px]" />
          <span className="text-[1.02rem] font-bold tracking-tight text-[#15211d]">
            Vacantless
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/realtors" className="hover:text-[#15211d]">
            For realtors
          </Link>
          <Link href="/compare/showinghero" className="hover:text-[#15211d]">
            Vacantless vs ShowingHero
          </Link>
          <Link href="/how-to" className="hover:text-[#15211d]">
            How-to videos
          </Link>
          <Link href="/about" className="hover:text-[#15211d]">
            About
          </Link>
          <Link href="/privacy" className="hover:text-[#15211d]">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-[#15211d]">
            Terms
          </Link>
          <a href={CONTACT_HREF} className="hover:text-[#15211d]">
            hello@vacantless.com
          </a>
        </div>
      </div>
      <p className="mx-auto mt-4 w-[min(1120px,calc(100%-32px))] text-[0.8rem] text-[#59655f]">
        {OPERATOR_LINE}
      </p>
    </footer>
  );
}

export function ProofStats({ stats }: { stats: readonly { value: string; label: string }[] }) {
  return (
    <div className="my-6 grid gap-4 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-[#d9e1dc] bg-[#f4f7f5] p-5">
          <b className="block text-[1.9rem] font-extrabold leading-none text-[#15211d]">{s.value}</b>
          <span className="mt-2 block text-[0.9rem] leading-snug text-[#59655f]">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
