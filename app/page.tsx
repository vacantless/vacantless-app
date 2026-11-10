import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-chrome";
import { OPERATOR_LINE } from "@/lib/operator-line";
import { LEASING_PROOF_STATS, POSTING_PROOF } from "@/lib/proof-stats";
import { TIERS, FREE_RENTAL_POSTING_LINE } from "@/lib/billing";
import { HOW_TO_COUNT_WORD } from "@/lib/how-to-videos";
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
      <MarketingHeader active="home" />
      <main>
        <Hero />
        <SeeItWork />
        <LeasingProof />
        <HowItWorks />
        <WhatYouGet />
        <Automations />
        <AfterTheLease />
        <LittleThings />
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
   was walked on prod by a brand-new org on 2026-10-08. Rent collection and
   expenses come later as upgrades and are not sold here. [S759: superseded;
   see AFTER_LEASE below. Everything built is offered once tested.] S713 (2026-10-13):
   posting to Kijiji, Rentals.ca and Zumper for you is the CA$49 Posting
   add-on on top of Growth, named once under the Growth card. */
function Hero() {
  return (
    <section className="relative isolate border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="max-w-[590px]">
          <Eyebrow>For landlords and property managers</Eyebrow>
          <h1 className="mb-[16px] max-w-[19ch] text-[clamp(2.2rem,4.6vw,3.4rem)] font-extrabold leading-[1.04] tracking-tight">
            <span className="block">Every renter answered.{" "}</span>
            <span className="block">Every viewing booked.</span>
          </h1>
          <p className="mb-[18px] max-w-[34rem] text-[clamp(1.1rem,1.8vw,1.32rem)] font-semibold leading-[1.4] text-[#203029]">
            Posted everywhere. Then rent, repairs, notices and taxes run on their own.
          </p>
          <p className="mb-[26px] max-w-[34rem] text-[clamp(1.02rem,1.6vw,1.16rem)] leading-[1.55] text-[#384a42]">
            Press Set Live and your ad goes up on the rental sites. Renters get a
            reply in seconds, pick a viewing time from your hours and get
            reminders before they come. You see every renter in one list, and
            you stop playing phone tag.
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
              Reminders go out on their own before each viewing, by email, and by text on Growth
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

/* Numbers from the founder's own rentals live in lib/proof-stats.ts. */
function LeasingProof() {
  return (
    <section id="leasing" className="border-b border-[#d9e1dc] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="It already runs on our own rentals.">
          Vacantless started as the system for the rentals its founder runs.
          Here is what it has handled there since May 2026.
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

const LEASING_STATS = LEASING_PROOF_STATS;

/* -------------------------------------------------------------- See it work */

/* S726: the 37-second ad, recorded on a test account with made-up renters
   (captions, no voice). Muted autoplay is allowed by browsers; the controls
   let people turn the music on. The how-tos live at /how-to. */
function SeeItWork() {
  return (
    <section id="video" className="border-b border-[#d9e1dc] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="See it work in 48 seconds.">
          A renter asks, books and confirms, and the landlord sees it all in one
          list. Made on a test account with made-up renters.{" "}
          <Link href="/how-to" className="font-semibold text-[#15211d] underline">
            {HOW_TO_COUNT_WORD} how-to videos
          </Link>
          .
        </SectionHead>
        <video
          className="aspect-video w-full rounded-lg border border-[#d9e1dc] bg-[#edf5f0] shadow-sm"
          src="/videos/ad-short.mp4"
          poster="/videos/ad-short.jpg"
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="metadata"
        />
      </div>
    </section>
  );
}

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
    title: "Press Set Live",
    body: "Your rental goes up on your Facebook Page and Marketplace. On Free, we post your one rental to Kijiji, Rentals.ca and Zumper too. With Posting, we post every rental. Every renter lands in the same place.",
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
      "An email confirmation and a reminder email the day before",
      "On Growth, a text the day before from your own local number. They reply YES to confirm",
      "A cancel link, so you hear about it instead of a no show",
    ],
  },
  {
    title: "For you",
    items: [
      "An email the moment a renter asks or books",
      "Every renter in one list, with their answers and notes",
      "A follow-up list when a viewing is cancelled",
      "Group viewings: several renters at one time, so a no-show costs you nothing",
      "A quick question after each viewing, so your list stays true",
      "Showing agents: hand viewings to the people who run them, each with a private phone page",
      "Your name and colours on every page and email renters see",
    ],
  },
];

/* S759: the four jobs Vacantless runs for a landlord (Noam, 2026-11-06:
   "automate showings, rent increases, taxes, repairs and the back and
   forth"). Every line was walked end to end on prod (Lakeview, S759):
   booking and reminders; the rent-increase sweep emailing the N1 reminder;
   tenant report -> tenant picks times -> trade accepts, quotes and books
   from a link -> tenant emailed -> cost on the owner statement; rent by
   pre-authorized debit (Stripe or Rotessa) or logged, costs from the bank,
   a file or typed in. Screenshots are real Lakeview pages
   (demo-videos/shots.mjs, public/marketing). */
const AUTOMATIONS: { kicker: string; title: string; points: string[]; img: string; alt: string; phone?: boolean }[] = [
  {
    kicker: "Showings",
    title: "Every renter answered and booked.",
    points: [
      "A reply with your booking link within seconds, day or night",
      "Renters pick a time from your viewing hours",
      "Reminders the day before, and they confirm with one tap or a YES by text",
      "Cancelled or no-show? They land on a follow-up list",
    ],
    img: "/marketing/auto-showings.jpg",
    alt: "A rental's booking page with open viewing times",
    phone: true,
  },
  {
    kicker: "Rent increases",
    title: "Never miss a rent increase again.",
    points: [
      "Vacantless tracks each lease's 12-month clock and this year's guideline",
      "We email you before the last day to serve, with the new rent worked out",
      "The N1 comes filled in. Record it and the clock resets for next year",
    ],
    img: "/marketing/auto-rent-increase.png",
    alt: "A tenancy's rent increase card: serve the N1 by November 17 for a February 15 increase",
  },
  {
    kicker: "Repairs",
    title: "Repairs without the back and forth.",
    points: [
      "Tenants report a problem from their own link, with photos",
      "They pick when they can be home. Your trade accepts, quotes and books from a link",
      "Vacantless finds the time that works for both, tells the tenant and reminds them the day before",
      "Mark it done and the cost goes on your books",
    ],
    img: "/marketing/auto-repairs.png",
    alt: "A repair job with the tenant's free times, the technician's window and the time that works for both",
  },
  {
    kicker: "Rent and taxes",
    title: "Rent in on the first. Tax time without the shoebox.",
    points: [
      "Rent by pre-authorized debit through your own Stripe or Rotessa account, or log e-transfers; you see who paid and who owes",
      "Costs come in from your bank, a bank file, repairs, or typed in",
      "One owner statement per building, and your T776 rental tax summary line by line",
      "One zip for your accountant: ledger, T776, statements, rent roll and QuickBooks or Xero files",
    ],
    img: "/marketing/auto-year-end.jpg",
    alt: "The owner statement: rent collected, expenses and net for the year",
  },
];

function Automations() {
  return (
    <section id="automations" className="border-b border-[#d9e1dc] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Then it runs the rest.">
          Ads posted and kept up. Renters answered and booked. Once the unit is rented: rent collected, rent increases served, repairs booked, and the books and tax papers done, on Growth.
        </SectionHead>
        <div className="grid gap-12 sm:gap-16">
          {AUTOMATIONS.map((a, i) => (
            <div
              key={a.kicker}
              className={`grid items-center gap-7 lg:grid-cols-2 lg:gap-12 ${i % 2 === 1 ? "lg:[&>figure]:order-first" : ""}`}
            >
              <div>
                <Eyebrow>{a.kicker}</Eyebrow>
                <h3 className="mb-4 max-w-[22ch] text-[clamp(1.5rem,2.6vw,2.05rem)] font-extrabold leading-[1.1]">
                  {a.title}
                </h3>
                <ul className="grid list-none gap-2.5 p-0">
                  {a.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-[0.98rem] leading-snug text-[#273832]">
                      <CheckMark />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <figure className={`m-0 ${a.phone ? "flex justify-center" : ""}`}>
                <img
                  src={a.img}
                  alt={a.alt}
                  loading="lazy"
                  decoding="async"
                  className={`h-auto rounded-xl border border-[#d9e1dc] bg-white shadow-[0_18px_50px_rgba(16,40,32,0.12)] ${a.phone ? "w-[min(320px,80%)]" : "w-full"}`}
                />
              </figure>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* S754d: the Ontario paperwork that comes after the lease. Every line is
   live: LTB forms N4, N5, N6, N8, N12, N13, L1, L2, L9, L10 filled from the
   tenancy (S748-S751), the rent increase tool with a filled N1 and the
   Ontario Standard Lease (public tools, S746-S743). S759 (Noam, 2026-11-06):
   offer everything that is built, backed by heavy testing, rather than
   waiting for a first outside user; rent collection, expenses and repairs
   were walked end to end on prod (Lakeview) before this card went up. */
const AFTER_LEASE: { title: string; body: string; href?: string; link?: string }[] = [
  {
    title: "Official LTB notices, filled in",
    body: "N4, N5, N8, N12, N13, L1, L2 and more, filled from the tenancy. Print or serve.",
    href: "/tools",
    link: "Free N4, N8 and N12 fillers",
  },
  {
    title: "The Ontario Standard Lease",
    body: "Filled from your rental. In Vacantless, everyone signs it online.",
    href: "/tools/standard-lease",
    link: "Fill one free",
  },
  {
    title: "Free tools, no sign-up",
    body: "The rent increase calculator with a filled N1, and the N4, N8 and N12 fillers.",
    href: "/tools/rent-increase",
    link: "Try the rent increase tool",
  },
];

function AfterTheLease() {
  return (
    <section id="paperwork" className="border-b border-[#d9e1dc] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="The paperwork, filled in.">
          For Ontario rentals. The forms come straight from the tenancy you already have.
        </SectionHead>
        <div className="grid gap-4 md:grid-cols-3">
          {AFTER_LEASE.map((c) => (
            <article key={c.title} className="rounded-lg border border-[#d9e1dc] bg-white p-[22px]">
              <h3 className="mb-2 text-[1.08rem] font-bold">{c.title}</h3>
              <p className="text-[0.9rem] leading-snug text-[#273832]">{c.body}</p>
              {c.href && c.link ? (
                <a href={c.href} className="mt-3 inline-block text-[0.9rem] font-semibold text-[var(--color-primary)] hover:underline">
                  {c.link}
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* S775: built features the site never named (claude/AUDIT-S775-HIDDEN-FEATURES.md).
   Noam approved the wording 2026-11-10 08:17 ("these must be mentioned somewhere
   on the site"). Each line was read live on Agile before shipping (S775): the
   screenshot card on Renters, Paste listing text and Drop a document on Add a
   rental, Quick replies "Next open", Suggest a new time and Nudge renter on
   Viewings, the video ad card and "brings you the most booked viewings" on a
   rental. The missed-call line follows app/api/sms/voice: a call to your
   texting number from a renter you know lands on their record. */
const LITTLE_THINGS: { text: string; plan?: string }[] = [
  { text: "Renter wrote in a chat? Upload the screenshot and they land in your list." },
  { text: "Have an old ad or a realtor's data sheet? Paste it or drop the PDF. The form fills itself." },
  { text: "Quick replies on your phone. Each rental's booking link and next open times, ready to share." },
  { text: "Time not working for a renter? Suggest up to three open times. They pick one." },
  { text: "Not sure a renter is coming? One tap nudges them to confirm." },
  { text: "A 15-second video ad made from your photos, ready for Facebook or Instagram." },
  { text: "Each rental shows which site brings renters who actually book." },
  { text: "Missed a call from a renter? It shows on their record with a reminder to call back.", plan: "Growth with texting" },
];

function LittleThings() {
  return (
    <section id="little-things" className="border-b border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Little things you may not know.">
          Small touches that save you a call, a trip or an hour.
        </SectionHead>
        <ul className="grid list-none gap-3 p-0 md:grid-cols-2">
          {LITTLE_THINGS.map((t) => (
            <li key={t.text} className="flex items-start gap-2 rounded-lg border border-[#d9e1dc] bg-white p-4 text-[0.92rem] leading-snug text-[#273832]">
              <CheckMark />
              <span>
                {t.text}
                {t.plan ? <span className="ml-1 text-xs text-[#5a6b64]">({t.plan})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- Pricing */

function Pricing() {
  return (
    <section id="pricing" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Two plans. One add-on.">
          Try it free on one rental. Move up when you have more than one. Add Posting when you want us to post more than one rental.
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
              {p.addon ? (
                <p className="mb-5 rounded-md bg-[#f4f7f5] px-3 py-2 text-[0.84rem] leading-snug text-[#273832]">
                  {p.addon}
                </p>
              ) : null}
              {p.featured ? (
                <PrimaryButton href={p.href}>{p.cta}</PrimaryButton>
              ) : (
                <SecondaryButton href={p.href}>{p.cta}</SecondaryButton>
              )}
            </article>
          ))}
        </div>
        <PostingAddonCard />
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
          Prices in Canadian dollars, plus applicable taxes. Cancel anytime.
        </p>
      </div>
    </section>
  );
}

/* S722: the Posting add-on gets its own card. Every line is live: sign in once
   (S705-S717), free ads post as soon as the robot has them ready (S754 standing
   setting; "approve each one" stays as a Billing switch), Kijiji
   bills its own fee per ad on the landlord's account (S713). Add-on needs a
   paid plan (lib/billing.ts canUseRobotPosting). */
const POSTING_ADDON_INCLUDES: string[] = [
  "We post your rental to Kijiji, Rentals.ca and Zumper for you",
  "On your own accounts. You sign in to each site once",
  "Ads go up as soon as they are ready, are kept up, and come down when the unit rents",
  "Change the rent or photos, and we update your live ads",
  "Every renter from those sites lands in the same list",
];

function PostingAddonCard() {
  return (
    <article
      id="posting-addon"
      className="mt-4 grid gap-4 rounded-lg border border-[#d9e1dc] bg-white p-[22px] md:grid-cols-[minmax(0,240px)_1fr] md:items-start"
    >
      <div>
        <p className="mb-1 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">
          Add-on, Free or Growth
        </p>
        <h3 className="mb-1 text-[1.08rem] font-semibold">Posting</h3>
        <span className="block text-[1.9rem] font-extrabold leading-tight">
          CA$49
          <small className="text-[0.86rem] font-bold text-[#59655f]"> a month</small>
        </span>
      </div>
      <div>
        <ul className="mb-3 grid list-none gap-2 p-0">
          {POSTING_ADDON_INCLUDES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-[0.86rem] leading-snug text-[#273832]">
              <CheckMark />
              {f}
            </li>
          ))}
        </ul>
        <p className="text-[0.84rem] leading-snug text-[#59655f]">
          {FREE_RENTAL_POSTING_LINE} Facebook Page posting and the Marketplace kit are free on every plan. On a computer, the free Vacantless helper for Chrome fills in the Marketplace form for you.
        </p>
        {/* S737 (review item 12): what Posting did on real rentals. Figures
            live in lib/proof-stats.ts and must stay true. */}
        <div className="mt-4 rounded-lg border border-[#d9e1dc] bg-[#f4f7f5] p-4">
          <p className="mb-1 text-[0.9rem] font-semibold text-[#15211d]">{POSTING_PROOF.title}</p>
          <p className="text-[0.86rem] leading-snug text-[#273832]">{POSTING_PROOF.lines.join(" ")}</p>
          <p className="mt-3 text-[0.86rem] leading-snug text-[#273832]">
            <b className="text-[1.15rem] font-extrabold text-[#15211d]">{POSTING_PROOF.statValue}</b>{" "}
            {POSTING_PROOF.statLabel} Every renter from every site lands in one list, with the booking link right away.
          </p>
          <p className="mt-2 text-[0.78rem] leading-snug text-[#59655f]">{POSTING_PROOF.footnote}</p>
        </div>
        {/* S742g: the one card on the page with no button (S740 review, item 3). */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SecondaryButton href="/signup?plan=posting">Start free, add Posting</SecondaryButton>
          <span className="text-[0.84rem] text-[#59655f]">You add it on your Billing page after your first rental is in.</span>
        </div>
      </div>
    </article>
  );
}

const PLANS: {
  name: string;
  price: string;
  priceNote?: string;
  body: string;
  includes: string[];
  /** S713: an optional paid add-on line under the plan's list. */
  addon?: string;
  cta: string;
  href: string;
  featured?: boolean;
}[] = [
  {
    name: "Free",
    price: "CA$0",
    priceNote: "a month",
    body: TIERS.free.blurb,
    includes: TIERS.free.features,
    // S734: Posting works on Free too (review item 5). S767: the one Free
    // rental is robot-posted to Rentals.ca and Zumper free; Posting covers more.
    addon: "Posting, CA$49 a month, posts every other rental for you. See below.",
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Growth",
    price: "CA$99",
    priceNote: "a month",
    body: TIERS.growth.blurb,
    // S728: the same bullets as the billing page, from one place (lib/billing.ts).
    includes: TIERS.growth.features,
    addon: "Add Posting for CA$49 a month. See below.",
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
          <Eyebrow>Why we built it</Eyebrow>
          <p className="mb-3.5 max-w-[44ch] text-[clamp(1.2rem,2.2vw,1.6rem)] font-semibold leading-snug text-[#273832]">
            &quot;I run rentals myself. I built Vacantless so renters stop
            waiting on me and I stop chasing viewings. Now other landlords
            can use it too.&quot;
          </p>
          <p className="text-base font-extrabold">
            Noam Muscovitch
            <span className="mt-0.5 block text-[0.86rem] font-semibold text-[#59655f]">
              Founder
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
          <Link href="/realtors" className="hover:text-[#15211d]">
            For realtors
          </Link>
          <Link href="/compare/showinghero" className="hover:text-[#15211d]">
            Vacantless vs ShowingHero
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
      <p className="mx-auto mt-4 w-[min(1120px,calc(100%-32px))] text-[0.8rem] text-[#59655f]">
        {OPERATOR_LINE}
      </p>
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
