import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VacantlessMark } from "../components/vacantless-mark";

export const metadata = {
  title: "Vacantless - Every renter answered, every viewing booked",
  description:
    "Share one link in your rental ads. Renters get an instant reply, book their own viewing time and get reminders. You see every renter in one list. Free for one rental, CA$99 a month after that.",
};

export const dynamic = "force-dynamic";

// Contact target for the "get help" CTAs. Kept in one place so it is easy to
// swap for a help route later. Neutral, scalable label (not one person's name).
const CONTACT_HREF = "mailto:hello@vacantless.com";
const CONTACT_LABEL = "Talk to our team";
const SIGNUP_LABEL = "Start free";

export default async function Home() {
  // Logged-in visitors skip the public marketing page and go straight to their
  // dashboard; logged-out visitors see the landing page below.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <SiteHeader />
      <main>
        <Hero />
        <LeasingProof />
        <HowItWorks />
        <WhatYouGet />
        <Pricing />
        <FounderBand />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ Buttons */

function PrimaryButton({
  href,
  children,
  className = "",
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary)] px-[18px] text-[0.92rem] font-bold text-white shadow-[0_8px_18px_rgba(23,54,47,0.18)] transition hover:bg-[var(--color-primary-hover)] ${className}`}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-[#d9e1dc] bg-white px-[18px] text-[0.92rem] font-bold text-[#203029] transition hover:bg-[#f4f7f5] ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------- Header */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[#d9e1dc]/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between gap-4 py-3.5">
        <Wordmark />
        <nav
          className="hidden items-center gap-[18px] text-[0.91rem] font-semibold text-[#59655f] md:flex"
          aria-label="Marketing sections"
        >
          <a href="#product" className="hover:text-[#15211d]">
            What you get
          </a>
          <a href="#how" className="hover:text-[#15211d]">
            How it works
          </a>
          <a href="#pricing" className="hover:text-[#15211d]">
            Plans
          </a>
          <Link href="/about" className="hover:text-[#15211d]">
            About
          </Link>
        </nav>
        <div className="flex flex-shrink-0 items-center gap-2.5">
          <SecondaryButton href="/login" className="hidden sm:inline-flex">
            Log in
          </SecondaryButton>
          <PrimaryButton href="/signup" ariaLabel="Start free with one rental">
            Start free
          </PrimaryButton>
        </div>
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <VacantlessMark variant="black" className="h-[30px] w-[30px]" />
      <span className="text-[1.02rem] font-bold tracking-tight text-[#15211d]">
        Vacantless
      </span>
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">
      {children}
    </p>
  );
}


/* -------------------------------------------------------------------- Hero */

/* S702: the site sells the leasing funnel only (Noam's go-to-market call,
   2026-10-05; price CA$99 a month flat, 2026-10-09). Everything on this page
   was walked on prod by a brand-new org on 2026-10-08. Rent collection,
   expenses and posting to rental sites for you come later as upgrades and are
   not sold here. */
function Hero() {
  return (
    <section className="relative isolate border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="max-w-[590px]">
          <Eyebrow>For landlords and property managers</Eyebrow>
          <h1 className="mb-[16px] max-w-[19ch] text-[clamp(2.2rem,4.6vw,3.4rem)] font-extrabold leading-[1.04] tracking-tight">
            Every renter answered. Every viewing booked.
          </h1>
          <p className="mb-[18px] max-w-[34rem] text-[clamp(1.1rem,1.8vw,1.32rem)] font-semibold leading-[1.4] text-[#203029]">
            Put one link in your rental ads. Vacantless does the back and forth.
          </p>
          <p className="mb-[26px] max-w-[34rem] text-[clamp(1.02rem,1.6vw,1.16rem)] leading-[1.55] text-[#384a42]">
            Renters get a reply in seconds. They pick a viewing time from your
            hours and get reminders before they come. You see every renter in
            one list, and you stop playing phone tag.
          </p>
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <PrimaryButton href="/signup">{SIGNUP_LABEL}</PrimaryButton>
            <SecondaryButton href={CONTACT_HREF}>
              {CONTACT_LABEL}
            </SecondaryButton>
          </div>
          <p className="max-w-[34rem] text-[0.86rem] font-semibold leading-snug text-[#59655f]">
            <span className="text-[var(--color-accent-strong)]">Free for one rental.</span>{" "}
            CA$99 a month for as many as you need. No card to start.
          </p>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}

/* The hero preview: what the landlord's renter list looks like. Fictional
   demo renters and times. */
function ProductPreview() {
  return (
    <div className="relative min-h-[460px] lg:min-h-[580px] lg:pl-6">
      <div className="relative z-[2] ml-auto w-full max-w-[670px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">Renters this week</span>
          <StatusPill tone="live">All answered</StatusPill>
        </div>
        <div className="p-[18px]">
          <div className="border-b border-[#d9e1dc] pb-4">
            <p className="mb-1.5 font-extrabold leading-tight">
              48 Maple Court, Unit 2
            </p>
            <p className="text-[0.82rem] leading-snug text-[#59655f]">
              1 bed, 1 bath · CA$1,650 a month
            </p>
          </div>
          <div className="my-4 grid gap-2.5">
            {PREVIEW_RENTERS.map((r) => (
              <div
                key={r.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-[#d9e1dc] bg-white px-3 py-2.5"
              >
                <div>
                  <strong className="block text-[0.82rem]">{r.name}</strong>
                  <span className="text-[0.78rem] text-[#59655f]">{r.detail}</span>
                </div>
                {r.booked ? (
                  <StatusPill tone="live">Booked</StatusPill>
                ) : (
                  <NavBadge>Replied</NavBadge>
                )}
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-[#d9e1dc] bg-[#f8faf8] p-3">
            <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-[#31584d]">
              <span className="inline-block h-[15px] w-[15px] rounded bg-[#1f8a5b]" />
              Reminders go out on their own before each viewing
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-[3] mt-4 w-full max-w-[330px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)] lg:absolute lg:-left-6 lg:bottom-0 lg:mt-0 lg:w-[54%]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">What the renter sees</span>
          <span className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#cad6cf]" />
            <span className="h-2 w-2 rounded-full bg-[#a9c8bc]" />
            <span className="h-2 w-2 rounded-full bg-[#d3b777]" />
          </span>
        </div>
        <div className="p-4">
          <p className="mb-0.5 text-[0.9rem] font-extrabold">Book a viewing</p>
          <p className="mb-2 text-[0.79rem] text-[#59655f]">Pick a time that works for you</p>
          <div className="grid grid-cols-3 gap-2">
            {PREVIEW_TIMES.map((t) => (
              <span
                key={t.label}
                className={`rounded-lg border px-2 py-2 text-center text-[0.74rem] font-semibold ${
                  t.picked
                    ? "border-[#5ba184] bg-[#e6f4ed] text-[#18583e]"
                    : "border-[#d9e1dc] bg-white text-[#37504a]"
                }`}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_RENTERS: { name: string; detail: string; booked?: boolean }[] = [
  { name: "Maya Chen", detail: "Viewing Thu 5:30 PM", booked: true },
  { name: "Daniel Park", detail: "Viewing Thu 6:00 PM", booked: true },
  { name: "Priya Shah", detail: "Sent the booking link" },
];

const PREVIEW_TIMES: { label: string; picked?: boolean }[] = [
  { label: "5:00 PM" },
  { label: "5:30 PM", picked: true },
  { label: "6:00 PM" },
];

/* ---------------------------------------------------------------- Section head */

function SectionHead({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-7">
      <h2 className="max-w-[20ch] text-[clamp(1.9rem,3.6vw,2.9rem)] font-extrabold leading-[1.05]">
        {title}
      </h2>
      <p className="max-w-[34rem] text-base leading-relaxed text-[#59655f]">
        {children}
      </p>
    </div>
  );
}

function CheckMark() {
  return (
    <svg className="mt-0.5 h-4 w-4 flex-none" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#e4f4ed" />
      <path
        d="M6 10.5l2.5 2.5L14 7.5"
        fill="none"
        stroke="#1f8a5b"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------ Leasing proof */

/* Numbers from the founder's own rentals (Agile Real Estate Group), counted
   from the database on 2026-10-09: 258 renter enquiries and 107 viewings since
   2026-06-26, 89 of the 107 booked by the renter on the listing page. Update
   them from the database, never from memory. */
function LeasingProof() {
  return (
    <section id="leasing" className="border-b border-[#d9e1dc] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="It already runs on our own rentals.">
          Vacantless started as the system for the rentals its founder runs.
          Here is what it has handled there since June.
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          {LEASING_STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-[#d9e1dc] bg-[#f4f7f5] p-6"
            >
              <b className="block text-[clamp(2rem,3.4vw,2.5rem)] font-extrabold leading-none text-[#15211d]">
                {s.value}
              </b>
              <span className="mt-2.5 block text-[0.92rem] leading-snug text-[#59655f]">
                {s.label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[0.82rem] leading-relaxed text-[#59655f]">
          Figures are from rentals the founder runs in Windsor, Ontario.
          Your own results will vary.
        </p>
      </div>
    </section>
  );
}

const LEASING_STATS: { value: string; label: string }[] = [
  { value: "258", label: "renter enquiries, all in one list." },
  { value: "107", label: "viewings booked." },
  { value: "8 in 10", label: "viewings booked by the renter, with no phone tag." },
];

/* ------------------------------------------------------------- How it works */

function HowItWorks() {
  return (
    <section id="how" className="border-b border-[#d9e1dc] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Set up in one sitting.">
          No new habits. Keep posting where you post today. Vacantless takes
          over once a renter clicks your link.
        </SectionHead>
        <ol className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border border-[#d9e1dc] bg-white p-5">
              <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e4f4ed] text-[0.9rem] font-extrabold text-[var(--color-accent)]">
                {i + 1}
              </span>
              <h3 className="mb-1.5 text-[1.02rem] font-bold">{step.title}</h3>
              <p className="text-[0.9rem] leading-relaxed text-[#59655f]">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const HOW_STEPS: { title: string; body: string }[] = [
  {
    title: "Add your rental",
    body: "The address, the rent, beds and baths, and a photo. That is enough to go live.",
  },
  {
    title: "Set your viewing hours",
    body: "Pick the times you can show the unit. Booked times drop off on their own.",
  },
  {
    title: "Share your link",
    body: "Paste it into Facebook Marketplace, Kijiji or any ad. Every renter lands in the same place.",
  },
  {
    title: "Show up",
    body: "Renters book, get reminded and can cancel in one tap. Afterwards you note how it went.",
  },
];

/* --------------------------------------------------------------- What you get */

function WhatYouGet() {
  return (
    <section id="product" className="border-b border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="What renters get, and what you get.">
          Fast answers for renters. A calmer inbox for you.
        </SectionHead>
        <div className="grid gap-4 md:grid-cols-2">
          {GET_GROUPS.map((g) => (
            <article key={g.title} className="rounded-lg border border-[#d9e1dc] bg-white p-[22px]">
              <h3 className="mb-3 text-[1.08rem] font-bold">{g.title}</h3>
              <ul className="grid list-none gap-2 p-0">
                {g.items.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-[0.9rem] leading-snug text-[#273832]">
                    <CheckMark />
                    {it}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const GET_GROUPS: { title: string; items: string[] }[] = [
  {
    title: "For the renter",
    items: [
      "A clean page for your unit with photos and the key facts",
      "A reply by email within seconds, with a link to book",
      "Viewing times they pick themselves, whenever suits them",
      "A confirmation and a reminder the day before, plus a text on Growth",
      "A cancel link, so you hear about it instead of a no show",
    ],
  },
  {
    title: "For you",
    items: [
      "An email the moment a renter asks or books",
      "Every renter in one list, with their answers and notes",
      "A follow-up list when a viewing is cancelled",
      "A quick question after each viewing, so your list stays true",
      "Your name and colours on every page and email renters see",
    ],
  },
];

/* --------------------------------------------------------------------- Pricing */

function Pricing() {
  return (
    <section id="pricing" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Two plans. Simple.">
          Try it free on one rental. Move up when you have more than one, or
          when you want renters texted.
        </SectionHead>
        <div className="grid gap-4 md:grid-cols-2">
          {PLANS.map((p) => (
            <article
              key={p.name}
              className={`flex min-h-[250px] flex-col rounded-lg border bg-white p-[22px] ${
                p.featured
                  ? "border-[#6ca58d] shadow-[0_12px_32px_rgba(32,92,66,0.12)]"
                  : "border-[#d9e1dc]"
              }`}
            >
              <h3 className="mb-2 text-[1.08rem] font-semibold">{p.name}</h3>
              <span className="my-1.5 block text-[1.9rem] font-extrabold leading-tight">
                {p.price}
                {p.priceNote ? (
                  <small className="text-[0.86rem] font-bold text-[#59655f]">
                    {" "}
                    {p.priceNote}
                  </small>
                ) : null}
              </span>
              <p className="mb-4 text-[0.92rem] leading-relaxed text-[#59655f]">
                {p.body}
              </p>
              <ul className="mb-5 grid flex-1 list-none content-start gap-2 p-0">
                {p.includes.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[0.86rem] leading-snug text-[#273832]"
                  >
                    <CheckMark />
                    {f}
                  </li>
                ))}
              </ul>
              {p.featured ? (
                <PrimaryButton href={p.href}>{p.cta}</PrimaryButton>
              ) : (
                <SecondaryButton href={p.href}>{p.cta}</SecondaryButton>
              )}
            </article>
          ))}
        </div>
        <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-lg border border-[#6ca58d] bg-[#f4f7f5] p-[18px] sm:flex-row sm:items-center">
          <div>
            <strong className="block text-[1rem]">Want a hand setting up?</strong>
            <span className="text-[0.9rem] leading-snug text-[#59655f]">
              Email us and we will set up your first rental with you.
            </span>
          </div>
          <SecondaryButton href={CONTACT_HREF} className="flex-none">
            {CONTACT_LABEL}
          </SecondaryButton>
        </div>
        <p className="mt-3.5 text-[0.86rem] text-[#59655f]">
          Prices in Canadian dollars. Cancel anytime.
        </p>
      </div>
    </section>
  );
}

const PLANS: {
  name: string;
  price: string;
  priceNote?: string;
  body: string;
  includes: string[];
  cta: string;
  href: string;
  featured?: boolean;
}[] = [
  {
    name: "Free",
    price: "CA$0",
    priceNote: "a month",
    body: "One live rental, with everything renters need to book.",
    includes: [
      "One live rental page",
      "Instant email replies with a booking link",
      "Self-booked viewings and email reminders",
      "Every renter in one list",
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Growth",
    price: "CA$99",
    priceNote: "a month",
    body: "As many rentals as you have, and renters get texts too.",
    includes: [
      "Unlimited live rentals",
      "Booking and reminder texts to renters",
      "Everything in Free",
      "Help from us when you need it",
    ],
    cta: "Choose Growth",
    href: "/signup?plan=growth",
    featured: true,
  },
];

/* ---------------------------------------------------------------- Founder band */

function FounderBand() {
  return (
    <section
      id="about"
      className="border-y border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]"
    >
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-6 md:grid-cols-[auto_1fr] md:gap-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/founder-2026-08.jpg"
          alt="Noam Muscovitch, founder of Vacantless"
          className="h-[104px] w-[104px] flex-none rounded-full object-cover shadow-[0_12px_32px_rgba(28,43,36,0.1)]"
        />
        <div>
          <Eyebrow>From the operator who built it</Eyebrow>
          <p className="mb-3.5 max-w-[44ch] text-[clamp(1.2rem,2.2vw,1.6rem)] font-semibold leading-snug text-[#273832]">
            &quot;I run rentals myself. I built Vacantless so renters stop
            waiting on me and I stop chasing viewings. Now other landlords
            can use it too.&quot;
          </p>
          <p className="text-base font-extrabold">
            Noam Muscovitch
            <span className="mt-0.5 block text-[0.86rem] font-semibold text-[#59655f]">
              Founder &amp; Operator
            </span>
          </p>
          <Link
            href="/about"
            className="mt-3.5 inline-block font-bold text-[var(--color-accent)] hover:underline"
          >
            Read the story &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Closing CTA */

function ClosingCta() {
  return (
    <section className="bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-white">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-5 py-14 md:grid-cols-[1fr_auto]">
        <div>
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,3.4vw,2.7rem)] font-extrabold leading-[1.06]">
            Ready to stop chasing renters?
          </h2>
          <p className="mt-2.5 max-w-[42ch] text-[#cfe0d8]">
            Start free with one rental. Share your link today.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg bg-white px-[18px] text-[0.92rem] font-bold text-[var(--color-primary)] transition hover:bg-[#eef4f1]"
          >
            {SIGNUP_LABEL}
          </Link>
          <Link
            href={CONTACT_HREF}
            className="inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-white/40 px-[18px] text-[0.92rem] font-bold text-white transition hover:bg-white/10"
          >
            {CONTACT_LABEL}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- Footer */

function SiteFooter() {
  return (
    <footer className="border-t border-[#d9e1dc] py-8 text-[0.86rem] text-[#59655f]">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <Wordmark />
        <span>
          Rental pages, instant replies, and self-booked viewings.
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {process.env.BROWSE_SURFACE_ENABLED === "true" && (
            <Link href="/rentals" className="hover:text-[#15211d]">
              Browse rentals
            </Link>
          )}
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
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            Start free
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------- Status pill helper */

type PillTone = "live" | "safe" | "lease";

function StatusPill({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  const tones: Record<PillTone, string> = {
    live: "bg-[#dcf3e9] text-[var(--color-accent-strong)]",
    safe: "bg-[#f8edd5] text-[#80510c]",
    lease: "bg-[#e3edf7] text-[#244f78]",
  };
  return (
    <span
      className={`inline-flex min-h-[30px] shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[0.75rem] font-extrabold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function NavBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] min-w-[24px] items-center justify-center rounded-full border border-[#d9e1dc] bg-white px-1 text-[0.72rem] font-extrabold text-[#4d5b55]">
      {children}
    </span>
  );
}
