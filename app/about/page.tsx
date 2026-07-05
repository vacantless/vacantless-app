import Link from "next/link";
import { VacantlessMark } from "../../components/vacantless-mark";

export const metadata = {
  title: "About Vacantless - built by a landlord, for landlords",
  description:
    "Vacantless started as the system one operator built to fill his own rentals without losing the thread. Now it is open to other small landlords.",
};

const CONTACT_HREF = "mailto:hello@vacantless.com";
const SIGNUP_LABEL = "Start with one rental free";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <SiteHeader />
      <main>
        <AboutHero />
        <Body />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[#d9e1dc]/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between gap-4 py-3.5">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <VacantlessMark variant="black" className="h-[30px] w-[30px]" />
          <span className="text-[1.02rem] font-bold tracking-tight text-[#15211d]">
            Vacantless
          </span>
        </Link>
        <nav
          className="hidden items-center gap-[18px] text-[0.91rem] font-semibold text-[#59655f] md:flex"
          aria-label="Marketing sections"
        >
          <Link href="/#workflow" className="hover:text-[#15211d]">
            Workflow
          </Link>
          <Link href="/#why" className="hover:text-[#15211d]">
            Why Vacantless
          </Link>
          <Link href="/#pricing" className="hover:text-[#15211d]">
            Pricing
          </Link>
          <Link href="/about" className="text-[#15211d]">
            About
          </Link>
        </nav>
        <Link
          href="/signup"
          aria-label={SIGNUP_LABEL}
          className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-[#17362f] bg-[#17362f] px-[18px] text-[0.92rem] font-bold text-white shadow-[0_8px_18px_rgba(23,54,47,0.18)] transition hover:bg-[#1f463c]"
        >
          <span aria-hidden className="sm:hidden">Start free</span>
          <span aria-hidden className="hidden sm:inline">{SIGNUP_LABEL}</span>
        </Link>
      </div>
    </header>
  );
}

function AboutHero() {
  return (
    <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
      <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-12 pt-16">
        <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
          About Vacantless
        </p>
        <h1 className="mb-[18px] max-w-[20ch] text-[clamp(2.2rem,4.6vw,3.4rem)] font-extrabold leading-[1.03] tracking-tight">
          Built by a landlord, for landlords.
        </h1>
        <p className="max-w-[52ch] text-[clamp(1.06rem,1.7vw,1.24rem)] leading-relaxed text-[#384a42]">
          Vacantless did not start as a product. It started as the system one
          operator built to fill his own rentals without losing the thread.
        </p>
        <div className="mt-11 flex items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/founder.jpg"
            alt="Noam Muscovitch, founder of Vacantless"
            className="h-[104px] w-[104px] flex-none rounded-full object-cover shadow-[0_12px_32px_rgba(28,43,36,0.1)]"
          />
          <div>
            <p className="text-[1.15rem] font-extrabold">Noam Muscovitch</p>
            <p className="mt-0.5 text-[0.9rem] font-semibold text-[#59655f]">
              Founder &amp; Operator
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Body() {
  return (
    <div className="mx-auto w-[min(920px,calc(100%-32px))] py-14">
      <p className="mb-4 max-w-[64ch] leading-relaxed text-[#384a42]">
        I am a working landlord. Filling a rental always meant the same
        scramble: a listing I could not easily take down, inquiries scattered
        across my inbox and Marketplace, viewing times settled over a dozen
        texts, and no clean record of who I actually chose once the unit was
        leased.
      </p>
      <p className="mb-4 max-w-[64ch] leading-relaxed text-[#384a42]">
        So I built a system to run it properly, one vacancy at a time. Post the
        rental page, share it only when it is ready, let renters book their own
        viewings into windows that suit me, keep every inquiry in one list, and
        carry the right renter straight into a tenancy record. It has run day to
        day on a real rental portfolio, and the numbers are the reason I decided
        to open it up.
      </p>

      <div className="my-6 grid gap-4 sm:grid-cols-3">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[#d9e1dc] bg-[#f4f7f5] p-5"
          >
            <b className="block text-[1.9rem] font-extrabold leading-none text-[#15211d]">
              {s.value}
            </b>
            <span className="mt-2 block text-[0.9rem] leading-snug text-[#59655f]">
              {s.label}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-9 text-[1.4rem] font-extrabold tracking-tight">
        What Vacantless is
      </h2>
      <p className="mb-4 max-w-[64ch] leading-relaxed text-[#384a42]">
        A calm, focused workspace for the leasing work around a live vacancy.
        Not an all-in-one property suite. The promise is narrow on purpose: do
        not lose the thread while filling this rental.
      </p>
      <ul className="my-2 grid list-none gap-3 p-0">
        {PRINCIPLES.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2.5 text-base text-[#273832]"
          >
            <span className="mt-[5px] h-4 w-4 flex-none rounded bg-[#1f8a5b]" />
            {p}
          </li>
        ))}
      </ul>

      <h2 className="mb-3 mt-9 text-[1.4rem] font-extrabold tracking-tight">
        Where it is headed
      </h2>
      <p className="max-w-[64ch] leading-relaxed text-[#384a42]">
        Vacantless is early and deliberately focused. It is not trying to manage
        your entire rental business. It helps you fill the rental in front of
        you without losing inquiries, viewings, follow-up, or the final handoff.
        It is being opened to other small landlords who want that same calm way
        to fill their rentals. If that is you, the best way to see it is to start
        with one rental, free.
      </p>
    </div>
  );
}

const STATS: { value: string; label: string }[] = [
  {
    value: "~9 in 10",
    label: "viewings self-booked by renters, without phone tag.",
  },
  {
    value: "~100 / mo",
    label: "renter inquiries handled through the workflow.",
  },
  {
    value: "50+ / mo",
    label: "viewings booked and coordinated in one place.",
  },
];

const PRINCIPLES: string[] = [
  "One rental, one clear path, from empty page to signed tenancy.",
  "Honest links: renters only ever see what the rental status allows.",
  "Built and used by an operator first, so it fits how leasing actually happens.",
];

function ClosingCta() {
  return (
    <section className="bg-gradient-to-br from-[#17362f] to-[#1f4a3f] text-white">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-5 py-14 md:grid-cols-[1fr_auto]">
        <div>
          <h2 className="max-w-[20ch] text-[clamp(1.7rem,3.2vw,2.4rem)] font-extrabold leading-[1.08]">
            See it on your own rental.
          </h2>
          <p className="mt-2.5 text-[#cfe0d8]">
            Start with one rental page, free. Add more when it is working for
            you.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg bg-white px-[18px] text-[0.92rem] font-bold text-[#17362f] transition hover:bg-[#eef4f1]"
          >
            {SIGNUP_LABEL}
          </Link>
          <Link
            href={CONTACT_HREF}
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-white/40 px-[18px] text-[0.92rem] font-bold text-white transition hover:bg-white/10"
          >
            Get help launching
          </Link>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-[#d9e1dc] py-8 text-[0.86rem] text-[#59655f]">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <VacantlessMark variant="black" className="h-[30px] w-[30px]" />
          <span className="text-[1.02rem] font-bold tracking-tight text-[#15211d]">
            Vacantless
          </span>
        </Link>
        <span>
          Rental page, safe sharing, viewing times, inquiries, tenancy handoff.
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
          <Link href="/login" className="hover:text-[#15211d]">
            Log in
          </Link>
          <Link
            href="/signup"
            className="font-semibold text-[#17362f] hover:underline"
          >
            Start free
          </Link>
        </div>
      </div>
    </footer>
  );
}
