import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VacantlessMark } from "../components/vacantless-mark";

export const metadata = {
  title: "Vacantless - Fill your next rental",
  description:
    "A calm leasing workspace for small landlords. Post the rental page, share it safely, set viewing times, collect inquiries, and move the right renter into a tenancy record.",
};

export const dynamic = "force-dynamic";

// Contact target for "get help launching" CTAs. Kept in one place so it is easy
// to swap for a help route later.
const CONTACT_HREF = "mailto:hello@vacantless.com";
const CONTACT_LABEL = "Get help launching";
const SIGNUP_LABEL = "Start with one rental free";

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
        <TrustStrip />
        <WhyReplaces />
        <Workflow />
        <SafeSharing />
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
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-[#17362f] bg-[#17362f] px-[18px] text-[0.92rem] font-bold text-white shadow-[0_8px_18px_rgba(23,54,47,0.18)] transition hover:bg-[#1f463c] ${className}`}
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
          <a href="#workflow" className="hover:text-[#15211d]">
            Workflow
          </a>
          <a href="#why" className="hover:text-[#15211d]">
            Why Vacantless
          </a>
          <a href="#pricing" className="hover:text-[#15211d]">
            Pricing
          </a>
          <Link href="/about" className="hover:text-[#15211d]">
            About
          </Link>
        </nav>
        <div className="flex flex-shrink-0 items-center gap-2.5">
          <SecondaryButton href="/login" className="hidden sm:inline-flex">
            Log in
          </SecondaryButton>
          <PrimaryButton href="/signup">
            <span className="sm:hidden">Start free</span>
            <span className="hidden sm:inline">{SIGNUP_LABEL}</span>
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
    <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------- Hero */

function Hero() {
  return (
    <section className="relative isolate border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Left: copy */}
        <div className="max-w-[570px]">
          <Eyebrow>Leasing workspace for small landlords</Eyebrow>
          <h1 className="mb-[18px] max-w-[14ch] text-[clamp(2.6rem,5.4vw,4.15rem)] font-extrabold leading-[1] tracking-tight">
            Fill your next rental without the scramble.
          </h1>
          <p className="mb-[26px] max-w-[33rem] text-[clamp(1.06rem,1.7vw,1.24rem)] leading-[1.55] text-[#384a42]">
            One calm place to post the rental, share it safely, book viewings,
            and move the right renter into a signed tenancy. No more juggling a
            spreadsheet, your inbox, and a dozen back-and-forth texts.
          </p>
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <PrimaryButton href="/signup">{SIGNUP_LABEL}</PrimaryButton>
            <SecondaryButton href={CONTACT_HREF}>
              {CONTACT_LABEL}
            </SecondaryButton>
          </div>
          <p className="text-[0.83rem] font-semibold text-[#59655f]">
            <span className="text-[#176044]">Free to start.</span> One live
            rental page, no card needed.
          </p>
        </div>

        {/* Right: product preview */}
        <ProductPreview />
      </div>
    </section>
  );
}

/* The hero product preview — a tangible dashboard so a landlord sees what the
   product actually does. Fictional demo data; no rent-collection/accounting
   claims. */
function ProductPreview() {
  return (
    <div className="relative min-h-[520px] lg:pl-6">
      {/* Main dashboard screen */}
      <div className="relative z-[2] ml-auto w-full max-w-[670px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">48 Maple Court</span>
          <StatusPill tone="live">Live - bookable</StatusPill>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[190px_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside
            className="hidden border-r border-[#d9e1dc] bg-[#f8faf8] p-4 sm:block"
            aria-label="Dashboard preview navigation"
          >
            {PREVIEW_NAV.map((n) => (
              <div
                key={n.label}
                className={`mb-2 flex min-h-[34px] items-center justify-between rounded-lg px-2.5 text-[0.78rem] font-semibold ${
                  n.active ? "bg-[#e2f0ea] text-[#174c42]" : "text-[#59655f]"
                }`}
              >
                {n.label} <NavBadge>{n.count}</NavBadge>
              </div>
            ))}
          </aside>
          {/* Workspace */}
          <div className="p-[18px]">
            <div className="flex items-start justify-between gap-4 border-b border-[#d9e1dc] pb-4">
              <div>
                <p className="mb-1.5 font-extrabold leading-tight">
                  48 Maple Court, Upper Suite
                </p>
                <p className="text-[0.82rem] leading-snug text-[#59655f]">
                  $2,150 / mo · 2 bed · 1 bath · available Sep 1
                </p>
              </div>
              <StatusPill tone="safe">Safe to share</StatusPill>
            </div>
            <div className="my-4 grid grid-cols-2 gap-3">
              {PREVIEW_TASKS.map((t) => (
                <div
                  key={t.title}
                  className="min-h-[95px] rounded-lg border border-[#d9e1dc] bg-white p-3"
                >
                  <strong className="mb-1.5 block text-[0.87rem]">
                    {t.title}
                  </strong>
                  <span className="text-[0.78rem] leading-snug text-[#59655f]">
                    {t.body}
                  </span>
                  <div className="mt-2.5 flex items-center gap-2 text-[0.75rem] font-semibold text-[#31584d]">
                    <span className="inline-block h-[15px] w-[15px] rounded bg-[#1f8a5b]" />
                    {t.line}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-2.5">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#d9e1dc] bg-white px-3 py-2.5">
                <div>
                  <strong className="block text-[0.82rem]">Maya Chen</strong>
                  <span className="text-[0.78rem] text-[#59655f]">
                    Booked Tue 6:30 PM
                  </span>
                </div>
                <StatusPill tone="lease">Ready to lease</StatusPill>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#d9e1dc] bg-white px-3 py-2.5">
                <div>
                  <strong className="block text-[0.82rem]">Daniel Park</strong>
                  <span className="text-[0.78rem] text-[#59655f]">
                    Asked about parking
                  </span>
                </div>
                <NavBadge>New</NavBadge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Side renter-view screen */}
      <div className="relative z-[3] mt-4 w-full max-w-[330px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)] lg:absolute lg:-left-6 lg:bottom-0 lg:mt-0 lg:w-[54%]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">Renter view</span>
          <span className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#cad6cf]" />
            <span className="h-2 w-2 rounded-full bg-[#a9c8bc]" />
            <span className="h-2 w-2 rounded-full bg-[#d3b777]" />
          </span>
        </div>
        <div className="p-4">
          <p className="mb-0.5 text-[0.9rem] font-extrabold">
            48 Maple Court, Upper Suite
          </p>
          <p className="mb-2 text-[0.79rem] text-[#59655f]">
            Pick a viewing time that works for you
          </p>
          <div className="grid grid-cols-3 gap-2">
            {PREVIEW_SLOTS.map((s) => (
              <span
                key={s.time}
                className={`rounded-lg border px-2 py-2 text-center text-[0.72rem] font-semibold ${
                  s.selected
                    ? "border-[#5ba184] bg-[#e6f4ed] text-[#18583e]"
                    : "border-[#d9e1dc] bg-white text-[#37504a]"
                }`}
              >
                {s.time}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_NAV: { label: string; count: string; active?: boolean }[] = [
  { label: "Overview", count: "3" },
  { label: "Rentals", count: "1", active: true },
  { label: "Inquiries", count: "8" },
  { label: "Viewings", count: "4" },
  { label: "Tenants", count: "2" },
];

const PREVIEW_TASKS: { title: string; body: string; line: string }[] = [
  {
    title: "Rental page",
    body: "Public page is live with the details renters need.",
    line: "Link ready",
  },
  {
    title: "Viewing times",
    body: "Evening and weekend windows are open to book.",
    line: "Slots open",
  },
  {
    title: "Inquiries",
    body: "New renter messages land beside booking activity.",
    line: "8 active",
  },
  {
    title: "Tenancy",
    body: "One strong renter is ready for the lease handoff.",
    line: "Convert next",
  },
];

const PREVIEW_SLOTS: { time: string; selected?: boolean }[] = [
  { time: "Tue 6:00" },
  { time: "Tue 6:30", selected: true },
  { time: "Thu 5:30" },
  { time: "Sat 10:00" },
  { time: "Sat 10:30" },
  { time: "Sun 12:00" },
];

/* ------------------------------------------------------------- Trust strip */

function TrustStrip() {
  return (
    <section className="border-b border-[#d9e1dc] bg-white">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-4 py-[26px] md:grid-cols-[auto_1fr] md:gap-[34px]">
        <p className="max-w-[16ch] text-[0.82rem] font-extrabold uppercase tracking-[0.06em] text-[#59655f]">
          Operator-built, on real rentals
        </p>
        <div className="grid gap-3.5 sm:grid-cols-3">
          {TRUST_ITEMS.map((t) => (
            <div
              key={t}
              className="flex items-start gap-2.5 text-[0.92rem] font-semibold text-[#273832]"
            >
              <span className="mt-[3px] h-[15px] w-[15px] flex-none rounded bg-[#1f8a5b]" />
              {t}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const TRUST_ITEMS: string[] = [
  "Built by working landlords, not a software team guessing at the job.",
  "~9 in 10 viewings self-booked by renters. No phone tag.",
  "Around 100 renter inquiries handled every month, on our own rentals.",
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

/* ------------------------------------------------------------ Why / replaces */

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

function CrossMark() {
  return (
    <svg className="mt-0.5 h-4 w-4 flex-none" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#efe7e4" />
      <path
        d="M6.5 6.5l7 7M13.5 6.5l-7 7"
        stroke="#b4726a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WhyReplaces() {
  return (
    <section
      id="why"
      className="border-y border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]"
    >
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Stop running your leasing out of five different apps.">
          Everything it takes to fill a rental, in one place, instead of
          scattered across tools that were never built for it.
        </SectionHead>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-lg border border-[#d9e1dc] bg-[#fbfaf9] p-[22px]">
            <h3 className="mb-4 text-[1.02rem] font-semibold">
              The usual scramble
            </h3>
            <ul className="grid list-none gap-3 p-0">
              {SCRAMBLE.map((x) => (
                <li
                  key={x}
                  className="flex items-start gap-2.5 text-[0.93rem] leading-snug text-[#384a42]"
                >
                  <CrossMark />
                  {x}
                </li>
              ))}
            </ul>
          </article>
          <article className="rounded-lg border border-[#d9e1dc] bg-white p-[22px]">
            <h3 className="mb-4 text-[1.02rem] font-semibold">
              With Vacantless
            </h3>
            <ul className="grid list-none gap-3 p-0">
              {WITH_VACANTLESS.map((x) => (
                <li
                  key={x}
                  className="flex items-start gap-2.5 text-[0.93rem] leading-snug text-[#273832]"
                >
                  <CheckMark />
                  {x}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

const SCRAMBLE: string[] = [
  "A listing link you cannot pause or take down once it is out there.",
  "Inquiries buried across your inbox and Marketplace chats.",
  "Viewing times settled over a dozen texts, with double-bookings and no-shows.",
  "No clean record of who you picked once the unit is finally leased.",
];

const WITH_VACANTLESS: string[] = [
  "A rental page you set Live, Paused, or Leased in one click, so the link always tells the truth.",
  "Every inquiry in one list, right next to the booking activity.",
  "Renters self-book into the windows you set. No phone tag.",
  "The chosen renter moves straight into a clean tenancy record.",
];

/* ------------------------------------------------------------------ Workflow */

function Workflow() {
  return (
    <section id="workflow" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="One rental, one clear path.">
          Keep the whole job around a single vacancy in one flow: prepare the
          rental, share it, coordinate viewings, and carry the chosen renter
          forward.
        </SectionHead>
        <div className="grid overflow-hidden rounded-lg border border-[#d9e1dc] bg-white lg:grid-cols-5">
          {WORKFLOW_STEPS.map((s, i) => (
            <article
              key={s.title}
              className={`min-h-[200px] p-5 ${
                i < WORKFLOW_STEPS.length - 1
                  ? "border-b border-[#d9e1dc] lg:border-b-0 lg:border-r"
                  : ""
              }`}
            >
              <span className="mb-5 grid h-[34px] w-[34px] place-items-center rounded-lg bg-[#17362f] text-[0.84rem] font-extrabold text-white">
                {i + 1}
              </span>
              <h3 className="mb-2.5 text-[1.06rem] font-semibold leading-tight">
                {s.title}
              </h3>
              <p className="text-[0.91rem] leading-relaxed text-[#59655f]">
                {s.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const WORKFLOW_STEPS: { title: string; body: string }[] = [
  {
    title: "Post the rental page",
    body: "Address, rent, photos, and the date it is available. Ready to share in minutes.",
  },
  {
    title: "Share it safely",
    body: "Draft, Live, Paused, and Leased states mean the link renters see always matches reality.",
  },
  {
    title: "Open viewing windows",
    body: "Set the times that suit you. Renters book themselves in, without the week turning into chaos.",
  },
  {
    title: "Work one inquiry list",
    body: "Messages, bookings, and follow-ups sit together, so no promising renter slips through.",
  },
  {
    title: "Hand off to a tenancy",
    body: "When you pick the renter, carry them straight into a tenancy record. The handoff is done.",
  },
];

/* -------------------------------------------------------------- Safe sharing */

function SafeSharing() {
  return (
    <section
      id="sharing"
      className="border-y border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]"
    >
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-stretch gap-8 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]">
        <div>
          <Eyebrow>Safer landlord operations</Eyebrow>
          <h2 className="mb-4 max-w-[13ch] text-[clamp(1.9rem,3.6vw,2.9rem)] font-extrabold leading-[1.05]">
            Share the right link at the right time
          </h2>
          <p className="text-base leading-relaxed text-[#59655f]">
            Vacantless keeps you clear on exactly what a renter can see and do:
            whether a page is still private, open for inquiries, paused, or
            closed for good.
          </p>
          <p className="mt-4 border-l-4 border-[#16756a] pl-4 text-[1.15rem] font-semibold leading-snug text-[#273832]">
            The promise is not &quot;manage everything.&quot; It is &quot;do not
            lose the thread while filling this rental.&quot;
          </p>
        </div>
        <div
          className="grid gap-3 rounded-lg border border-[#d9e1dc] bg-white p-4 shadow-[0_12px_32px_rgba(28,43,36,0.08)]"
          aria-label="Rental status sharing model"
        >
          {SHARING_STATES.map((s) => (
            <div
              key={s.name}
              className="grid grid-cols-1 items-center gap-3 rounded-lg border border-[#d9e1dc] bg-white p-3 sm:grid-cols-[118px_minmax(0,1fr)_auto]"
            >
              <strong className="text-[0.9rem]">{s.name}</strong>
              <span className="text-[0.84rem] leading-snug text-[#59655f]">
                {s.body}
              </span>
              <span
                className={`inline-flex min-h-[34px] min-w-[94px] items-center justify-center whitespace-nowrap rounded-lg border px-3 text-[0.75rem] font-extrabold ${
                  s.on
                    ? "border-[#2f8562] bg-[#e4f4ed] text-[#176044]"
                    : "border-[#d9e1dc] bg-white text-[#53615c]"
                }`}
              >
                {s.action}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SHARING_STATES: {
  name: string;
  body: string;
  action: string;
  on?: boolean;
}[] = [
  {
    name: "Draft",
    body: "Prepare copy and details before renters ever see the page.",
    action: "Keep private",
  },
  {
    name: "Live",
    body: "Public page can collect inquiries and viewing bookings.",
    action: "Copy link",
    on: true,
  },
  {
    name: "Paused",
    body: "Keep the record, stop new renter bookings for now.",
    action: "Not bookable",
  },
  {
    name: "Leased",
    body: "Show renters the unit is no longer available.",
    action: "Unavailable",
  },
];

/* --------------------------------------------------------------------- Pricing */

function Pricing() {
  return (
    <section id="pricing" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Start with one rental. Grow when you are ready.">
          Launch a single rental page first. Add more live rentals once the
          workflow is earning its place.
        </SectionHead>
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => (
            <article
              key={p.name}
              className={`flex min-h-[250px] flex-col rounded-lg border bg-white p-[22px] ${
                p.featured
                  ? "border-[#6ca58d] shadow-[0_12px_32px_rgba(32,92,66,0.12)]"
                  : "border-[#d9e1dc]"
              }`}
            >
              {p.ribbon ? (
                <span className="mb-2.5 inline-flex self-start rounded-full bg-[#e4f4ed] px-2.5 py-1 text-[0.68rem] font-extrabold uppercase tracking-[0.06em] text-[#16756a]">
                  {p.ribbon}
                </span>
              ) : null}
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
              <p className="mb-5 flex-1 text-[0.92rem] leading-relaxed text-[#59655f]">
                {p.body}
              </p>
              {p.featured ? (
                <PrimaryButton href={p.href}>{p.cta}</PrimaryButton>
              ) : (
                <SecondaryButton href={p.href}>{p.cta}</SecondaryButton>
              )}
            </article>
          ))}
        </div>
        <p className="mt-[18px] text-[0.86rem] text-[#59655f]">
          Prices in CAD, flat monthly. Prefer we set it up with you?{" "}
          <Link
            href={CONTACT_HREF}
            className="font-bold text-[#16756a] hover:underline"
          >
            Get help launching
          </Link>
          .
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
  cta: string;
  href: string;
  featured?: boolean;
  ribbon?: string;
}[] = [
  {
    name: "Free",
    price: "$0",
    priceNote: "/ month",
    body: "One live rental page to collect inquiries and viewing bookings. No card needed to start.",
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Growth",
    price: "$99",
    priceNote: "/ month",
    body: "Run more than one live rental at a time, with the full vacancy-to-tenancy workflow.",
    cta: "Choose Growth",
    href: "/signup",
    featured: true,
    ribbon: "Most popular",
  },
  {
    name: "Premium",
    price: "$249",
    priceNote: "/ month",
    body: "For operators running a portfolio who want the whole leasing workspace in one place.",
    cta: "Choose Premium",
    href: "/signup",
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
          src="/founder.jpg"
          alt="Noam Muscovitch, founder of Vacantless"
          className="h-[104px] w-[104px] flex-none rounded-full object-cover shadow-[0_12px_32px_rgba(28,43,36,0.1)]"
        />
        <div>
          <Eyebrow>From the operator who built it</Eyebrow>
          <p className="mb-3.5 max-w-[44ch] text-[clamp(1.2rem,2.2vw,1.6rem)] font-semibold leading-snug text-[#273832]">
            &quot;I run my own rentals. Vacantless is the system I built to fill
            them without the chaos, now opened up for other small landlords.&quot;
          </p>
          <p className="text-base font-extrabold">
            Noam Muscovitch
            <span className="mt-0.5 block text-[0.86rem] font-semibold text-[#59655f]">
              Founder &amp; Operator
            </span>
          </p>
          <Link
            href="/about"
            className="mt-3.5 inline-block font-bold text-[#16756a] hover:underline"
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
    <section className="bg-gradient-to-br from-[#17362f] to-[#1f4a3f] text-white">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-5 py-14 md:grid-cols-[1fr_auto]">
        <div>
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,3.4vw,2.7rem)] font-extrabold leading-[1.06]">
            Ready to fill your next rental?
          </h2>
          <p className="mt-2.5 max-w-[40ch] text-[#cfe0d8]">
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
          Rental page, safe sharing, viewing times, inquiries, tenancy handoff.
        </span>
        <div className="flex items-center gap-4">
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
    live: "bg-[#dcf3e9] text-[#176044]",
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
