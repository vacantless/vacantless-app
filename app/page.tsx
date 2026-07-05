import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VacantlessMark } from "../components/vacantless-mark";

export const metadata = {
  title: "Vacantless - Run your rentals in one place",
  description:
    "Advertise the unit, screen renters, collect the rent, and track the money, all in one place. Built by a working landlord. Vacantless takes no cut of your rent.",
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
        <ProductDepth />
        <TrustLine />
        <RentSection />
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
          <a href="#product" className="hover:text-[#15211d]">
            What you get
          </a>
          <a href="#rent" className="hover:text-[#15211d]">
            Rent collection
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
    <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------- Hero */

function Hero() {
  return (
    <section className="relative isolate border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
      <div className="mx-auto grid w-[min(1120px,calc(100%-32px))] items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* Left: copy */}
        <div className="max-w-[590px]">
          <Eyebrow>For small landlords</Eyebrow>
          <h1 className="mb-[16px] max-w-[16ch] text-[clamp(2.4rem,5vw,3.85rem)] font-extrabold leading-[1.03] tracking-tight">
            Everything it takes to run your rentals.
          </h1>
          <p className="mb-[18px] max-w-[34rem] text-[clamp(1.1rem,1.8vw,1.32rem)] font-semibold leading-[1.4] text-[#203029]">
            Fill the unit. Collect the rent. Track the money.
          </p>
          <p className="mb-[26px] max-w-[34rem] text-[clamp(1.02rem,1.6vw,1.16rem)] leading-[1.55] text-[#384a42]">
            Vacantless is built for landlords with one unit up to a small
            portfolio. Advertise the rental, book showings, screen renters,
            collect rent after your tenant authorizes it, and keep the books, all
            in one calm place instead of a dozen apps.
          </p>
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <PrimaryButton href="/signup">{SIGNUP_LABEL}</PrimaryButton>
            <SecondaryButton href={CONTACT_HREF}>
              {CONTACT_LABEL}
            </SecondaryButton>
          </div>
          <p className="max-w-[34rem] text-[0.86rem] font-semibold leading-snug text-[#59655f]">
            <span className="text-[#176044]">Free to start</span> with one rental.
            Automatic rent collection is part of Growth, set up when you and your
            tenant are ready.
          </p>
        </div>

        {/* Right: product preview */}
        <ProductPreview />
      </div>
    </section>
  );
}

/* The hero product preview - a tangible dashboard so a landlord sees what the
   product actually does. Fictional demo data; the rent figures are illustrative
   only and make no availability or guaranteed-collection claim. */
function ProductPreview() {
  return (
    <div className="relative min-h-[480px] lg:pl-6">
      {/* Main dashboard screen */}
      <div className="relative z-[2] ml-auto w-full max-w-[670px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">Rent this month</span>
          <StatusPill tone="live">On track</StatusPill>
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
                  48 Maple Court, 3 units
                </p>
                <p className="text-[0.82rem] leading-snug text-[#59655f]">
                  Collected $6,450 of $6,450 · next pull Aug 1
                </p>
              </div>
              <StatusPill tone="lease">No cut taken</StatusPill>
            </div>
            <div className="my-4 grid gap-2.5">
              {PREVIEW_RENT.map((r) => (
                <div
                  key={r.unit}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#d9e1dc] bg-white px-3 py-2.5"
                >
                  <div>
                    <strong className="block text-[0.82rem]">{r.unit}</strong>
                    <span className="text-[0.78rem] text-[#59655f]">
                      {r.tenant} · {r.amount}
                    </span>
                  </div>
                  {r.paid ? (
                    <StatusPill tone="live">Paid</StatusPill>
                  ) : (
                    <NavBadge>Scheduled</NavBadge>
                  )}
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-[#d9e1dc] bg-[#f8faf8] p-3">
              <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-[#31584d]">
                <span className="inline-block h-[15px] w-[15px] rounded bg-[#1f8a5b]" />
                Pulled from the tenant&apos;s bank after they authorize it
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Side renter-view screen */}
      <div className="relative z-[3] mt-4 w-full max-w-[330px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)] lg:absolute lg:-left-6 lg:bottom-0 lg:mt-0 lg:w-[54%]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">Tenant view</span>
          <span className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#cad6cf]" />
            <span className="h-2 w-2 rounded-full bg-[#a9c8bc]" />
            <span className="h-2 w-2 rounded-full bg-[#d3b777]" />
          </span>
        </div>
        <div className="p-4">
          <p className="mb-0.5 text-[0.9rem] font-extrabold">
            Authorize rent payments
          </p>
          <p className="mb-2 text-[0.79rem] text-[#59655f]">
            Rent is only pulled after you approve it
          </p>
          <div className="grid gap-2">
            {PREVIEW_AUTH.map((s) => (
              <span
                key={s.label}
                className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-[0.74rem] font-semibold ${
                  s.done
                    ? "border-[#5ba184] bg-[#e6f4ed] text-[#18583e]"
                    : "border-[#d9e1dc] bg-white text-[#37504a]"
                }`}
              >
                {s.label}
                <span>{s.done ? "Done" : "..."}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_NAV: { label: string; count: string; active?: boolean }[] = [
  { label: "Rent", count: "3", active: true },
  { label: "Tenants", count: "3" },
  { label: "Expenses", count: "9" },
  { label: "Rentals", count: "1" },
  { label: "Reports", count: "2" },
];

const PREVIEW_RENT: {
  unit: string;
  tenant: string;
  amount: string;
  paid?: boolean;
}[] = [
  { unit: "Unit 1", tenant: "Maya Chen", amount: "$2,150", paid: true },
  { unit: "Unit 2", tenant: "Daniel Park", amount: "$2,150", paid: true },
  { unit: "Unit 3", tenant: "Priya Shah", amount: "$2,150" },
];

const PREVIEW_AUTH: { label: string; done?: boolean }[] = [
  { label: "Connect bank account", done: true },
  { label: "Confirm rent amount", done: true },
  { label: "Approve monthly pull", done: true },
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

/* ------------------------------------------------------------- Product depth */

/* The complete product in landlord language, grouped by job so nothing is
   hidden. This is the crux of the software, so it leads (right after the hero,
   before the rent-collection detail). Availability of individual features varies
   by plan; hedged with "where available" / "by plan" rather than tier badges.
   Every group maps to a real, shipped capability (verified against lib/billing.ts
   TIERS + entitlements). No replacement claims about FreshBooks, DocuSign,
   Rotessa, Stripe, lawyers, or official Ontario forms. */
function ProductDepth() {
  return (
    <section id="product" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="The whole rental, from empty to earning.">
          One place for the entire job, grouped the way you actually work, from an
          empty unit to rent in the bank and the books kept. Nothing hidden.
        </SectionHead>
        <div className="grid gap-4 md:grid-cols-2">
          {PRODUCT_GROUPS.map((g) => (
            <article
              key={g.title}
              className="rounded-lg border border-[#d9e1dc] bg-white p-[22px]"
            >
              <div className="mb-3.5 flex items-baseline gap-2.5">
                <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg bg-[#17362f] text-[0.76rem] font-extrabold text-white">
                  {g.n}
                </span>
                <h3 className="text-[1.06rem] font-semibold leading-tight">
                  {g.title}
                </h3>
              </div>
              <ul className="grid list-none gap-2 p-0">
                {g.items.map((it) => (
                  <li
                    key={it}
                    className="flex items-start gap-2 text-[0.9rem] leading-snug text-[#273832]"
                  >
                    <CheckMark />
                    {it}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p className="mt-5 max-w-[62rem] text-[0.86rem] leading-relaxed text-[#59655f]">
          Some features depend on your plan. Vacantless organizes and tracks this
          work in one place and works alongside your existing tools. Official
          Ontario forms, your accountant, and your signing tool stay yours.
          Vacantless keeps the records organized around them.
        </p>
      </div>
    </section>
  );
}

const PRODUCT_GROUPS: { n: string; title: string; items: string[] }[] = [
  {
    n: "1",
    title: "Advertise the rental",
    items: [
      "A branded rental page for each unit",
      "Listing copy to post with",
      "A listing hub that prepares your listing for more rental sites",
    ],
  },
  {
    n: "2",
    title: "Book showings",
    items: [
      "Showing windows you set",
      "Renters self-book their own viewing time",
      "Showing reminders",
      "Follow-up after the showing",
    ],
  },
  {
    n: "3",
    title: "Manage renter conversations",
    items: [
      "Every inquiry in one list",
      "Screening questions on your page",
      "Notes on each renter",
      "Email and text follow-up, where available by plan",
    ],
  },
  {
    n: "4",
    title: "Choose the renter",
    items: [
      "Renter details in one place",
      "Tenant records once you pick someone",
      "Documents and important details attached to the rental",
    ],
  },
  {
    n: "5",
    title: "Collect rent",
    items: [
      "Tenant-authorized bank debit",
      "Stripe bank debit, or your own Rotessa account",
      "A rent ledger and payment status",
      "Bank-fed rent matching, where enabled",
    ],
  },
  {
    n: "6",
    title: "Track money",
    items: [
      "Rent ledger, expenses, and receipts",
      "A bank feed, similar in spirit to FreshBooks-style expense tracking",
      "Year-end tax export",
      "Owner statements",
    ],
  },
  {
    n: "7",
    title: "Handle repairs",
    items: [
      "Tenant repair requests",
      "Work orders",
      "Repair dispatch and reminders, where available",
    ],
  },
  {
    n: "8",
    title: "See reports and protect ROI",
    items: [
      "Rent roll and an income-and-expense view",
      "Cap-rate and NOI-style reporting, where available",
      "Portfolio reports",
      "Rent-increase reminders and important dates",
    ],
  },
];

/* ------------------------------------------------------------- Trust line */

function TrustLine() {
  return (
    <section className="border-y border-[#d9e1dc] bg-[#17362f] text-white">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] flex-col items-start gap-3 py-7 sm:flex-row sm:items-center sm:gap-6">
        <p className="text-[1.02rem] font-extrabold leading-snug">
          Vacantless does not take a cut of your rent.
        </p>
        <p className="text-[0.94rem] leading-snug text-[#cfe0d8]">
          Stripe or Rotessa processor fees pass straight through. Vacantless
          makes money from your monthly plan, not from marking up your rent
          payments.
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Rent collection */

/* All the rent-collection detail in ONE section (story + how it works + a
   demoted cost breakdown), placed AFTER the product depth so the page does not
   open on five rent sections in a row. Rent is the flagship capability, not the
   whole pitch. The per-unit cost table lives inside a <details> so the flat
   summary ($99 + a small Stripe fee, no cut) is what a cold one-unit landlord
   sees first, with the full per-unit math one tap away. Availability stays
   hedged (Stripe TEST / Rotessa closed to new signups / GTM sell-hold): "set it
   up when you are ready", nothing debited until the tenant authorizes. No
   guaranteed-savings claim; no bank-specific cheque pricing. Money story is
   non-identifying. */
function RentSection() {
  return (
    <section
      id="rent"
      className="border-b border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]"
    >
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Collect rent automatically, when you are ready.">
          Rent collection is the reason many landlords start. Set it up once and
          rent runs on schedule, so you stop chasing cheques and e-transfers.
        </SectionHead>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Left: the money story */}
          <div>
            <p className="mb-3.5 text-base leading-relaxed text-[#384a42]">
              Cheques and e-transfers rely on memory. One missed reminder, one
              repair dispute, or one awkward rent conversation can quietly cost
              you. One landlord missed the right moment for a rent increase while
              repair issues were going on, and ended up giving a free month to
              keep the peace.
            </p>
            <p className="mb-4 text-base leading-relaxed text-[#384a42]">
              Automatic rent collection cannot solve every problem, but it removes
              one common friction point: rent is scheduled, authorized, pulled,
              and recorded.
            </p>
            <p className="mb-4 border-l-4 border-[#16756a] pl-4 text-[1.12rem] font-semibold leading-snug text-[#273832]">
              The cheque book is the small cost. The missed rent conversation is
              the expensive one.
            </p>
            <p className="mb-3 text-[0.94rem] font-semibold text-[#37504a]">
              Vacantless helps reduce common money leaks:
            </p>
            <ul className="grid list-none gap-2.5 p-0">
              {MONEY_LEAKS.map((x) => (
                <li
                  key={x}
                  className="flex items-start gap-2.5 text-[0.92rem] leading-snug text-[#273832]"
                >
                  <CheckMark />
                  {x}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: how it works */}
          <div className="rounded-lg border border-[#d9e1dc] bg-white p-5 shadow-[0_12px_32px_rgba(28,43,36,0.08)] sm:p-6">
            <h3 className="mb-4 text-[1.06rem] font-semibold">
              How rent collection works
            </h3>
            <ol className="grid list-none gap-0 p-0">
              {RENT_STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className={`flex gap-3.5 ${
                    i < RENT_STEPS.length - 1 ? "pb-4" : ""
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-[#17362f] text-[0.8rem] font-extrabold text-white">
                      {i + 1}
                    </span>
                    {i < RENT_STEPS.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-[#d9e1dc]" aria-hidden="true" />
                    ) : null}
                  </div>
                  <div className="pb-1">
                    <strong className="block text-[0.94rem] leading-tight">
                      {step.title}
                    </strong>
                    <span className="mt-0.5 block text-[0.85rem] leading-snug text-[#59655f]">
                      {step.body}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 border-l-4 border-[#16756a] bg-[#f4f7f5] py-2.5 pl-4 pr-3 text-[0.82rem] leading-snug text-[#37504a]">
              Rent is only ever debited after your tenant authorizes their bank
              account. Vacantless never holds your funds, never stores tenant
              bank-account numbers, and adds no fee of its own on rent.
            </p>
          </div>
        </div>

        {/* Demoted cost breakdown - flat summary visible, per-unit table on tap. */}
        <div className="mt-10 rounded-lg border border-[#d9e1dc] bg-white p-5 shadow-[0_12px_32px_rgba(28,43,36,0.08)] sm:p-6">
          <h3 className="text-[1.06rem] font-semibold">What it costs</h3>
          <p className="mt-2 max-w-[62rem] text-base leading-relaxed text-[#384a42]">
            One flat plan, no matter how many units. The Growth plan is CA$99 a
            month. Stripe adds about CA$5 per payment it pulls. Vacantless takes
            no cut of your rent, and the more units you run, the less each one
            costs.
          </p>
          <details className="mt-4 rounded-lg border border-[#d9e1dc] bg-[#fbfcfb]">
            <summary className="cursor-pointer list-none px-4 py-3 text-[0.9rem] font-bold text-[#17362f] [&::-webkit-details-marker]:hidden">
              See the cost per unit
            </summary>
            <div className="border-t border-[#d9e1dc] px-1 pb-2">
              <div className="hidden px-4 py-3 text-[0.72rem] font-extrabold uppercase tracking-[0.06em] text-[#59655f] md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:gap-4">
                <span>Your property</span>
                <span>Stripe + Growth</span>
                <span>Per month</span>
                <span>Per unit</span>
              </div>
              {COST_ROWS.map((r) => (
                <div
                  key={r.property}
                  className="grid gap-x-4 gap-y-1.5 border-t border-[#eaefec] px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:items-center md:border-t"
                >
                  <strong className="text-[0.9rem] leading-snug text-[#15211d]">
                    {r.property}
                  </strong>
                  <div className="text-[0.85rem] leading-snug text-[#59655f]">
                    <span className="mb-0.5 block text-[0.64rem] font-extrabold uppercase tracking-[0.05em] text-[#98938d] md:hidden">
                      Stripe + Growth
                    </span>
                    {r.breakdown}
                  </div>
                  <div className="text-[0.9rem] font-extrabold text-[#15211d]">
                    <span className="mb-0.5 block text-[0.64rem] font-extrabold uppercase tracking-[0.05em] text-[#98938d] md:hidden">
                      Per month
                    </span>
                    {r.perMonth}
                  </div>
                  <div className="text-[0.9rem] font-bold text-[#176044]">
                    <span className="mb-0.5 block text-[0.64rem] font-extrabold uppercase tracking-[0.05em] text-[#16756a] md:hidden">
                      Per unit
                    </span>
                    {r.perUnit}
                  </div>
                </div>
              ))}
              <ul className="mt-2 grid list-none gap-1.5 px-4 pb-2 pt-3 text-[0.8rem] leading-relaxed text-[#59655f]">
                {COST_SMALL_PRINT.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span className="mt-[7px] h-[4px] w-[4px] flex-none rounded-full bg-[#9aa7a1]" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

const MONEY_LEAKS: string[] = [
  "Late rent follow-up, chased month after month.",
  "Missed rent increases and important tenancy dates.",
  "Repair costs with no clear record behind them.",
  "Missing receipts at tax time.",
  "Unclear records when you need to know who paid what.",
];

const RENT_STEPS: { title: string; body: string }[] = [
  {
    title: "Choose the Growth plan",
    body: "Automatic rent collection is included on Growth and Premium.",
  },
  {
    title: "Add the tenancy",
    body: "Create the tenancy record with the tenant and the monthly rent amount.",
  },
  {
    title: "Connect Stripe or Rotessa",
    body: "Use Vacantless's Stripe setup, or connect your own Rotessa account.",
  },
  {
    title: "Tenant authorizes their bank",
    body: "Your tenant confirms their bank account. Nothing is debited until they do.",
  },
  {
    title: "Schedule the monthly rent",
    body: "Pick the first payment date, and the amount pulls automatically each month.",
  },
  {
    title: "See what came in",
    body: "Payments continue every month, tracked in one place, until you change or cancel the schedule.",
  },
];

const COST_ROWS: {
  property: string;
  breakdown: string;
  perMonth: string;
  perUnit: string;
}[] = [
  {
    property: "1 unit (condo or basement unit)",
    breakdown: "CA$5 Stripe + CA$99 Growth",
    perMonth: "CA$104",
    perUnit: "CA$104.00 / unit",
  },
  {
    property: "2 units (duplex)",
    breakdown: "CA$10 Stripe + CA$99 Growth",
    perMonth: "CA$109",
    perUnit: "CA$54.50 / unit",
  },
  {
    property: "3 units (triplex)",
    breakdown: "CA$15 Stripe + CA$99 Growth",
    perMonth: "CA$114",
    perUnit: "CA$38.00 / unit",
  },
  {
    property: "4 units (fourplex)",
    breakdown: "CA$20 Stripe + CA$99 Growth",
    perMonth: "CA$119",
    perUnit: "CA$29.75 / unit",
  },
  {
    property: "5 units (fiveplex)",
    breakdown: "CA$25 Stripe + CA$99 Growth",
    perMonth: "CA$124",
    perUnit: "CA$24.80 / unit",
  },
  {
    property: "20 units (small portfolio)",
    breakdown: "CA$100 Stripe + CA$99 Growth",
    perMonth: "CA$199",
    perUnit: "CA$9.95 / unit",
  },
];

const COST_SMALL_PRINT: string[] = [
  "Estimates assume the CA$5 Stripe cap per successful payment. They exclude tax and any failed, disputed, or verification fees.",
  "If you connect your own Rotessa account, Rotessa pricing applies instead. Rotessa may be cheaper depending on your account and transaction volume.",
  "Vacantless does not mark up processor fees. The processor's fee passes straight through.",
  "Rent collection is set up once your Stripe or Rotessa account is connected and your tenant authorizes their bank account.",
];

/* --------------------------------------------------------------------- Pricing */

function Pricing() {
  return (
    <section id="pricing" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Three plans. Rent collection starts on Growth.">
          Start free to fill a vacancy. Move to Growth when you want to collect
          rent automatically. Premium adds your books, repairs, and reminders.
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
            <strong className="block text-[1rem]">Get help getting started</strong>
            <span className="text-[0.9rem] leading-snug text-[#59655f]">
              Rather not set it up yourself? We will get your first rental and your
              rent collection going, and walk you through it.
            </span>
          </div>
          <SecondaryButton href={CONTACT_HREF} className="flex-none">
            {CONTACT_LABEL}
          </SecondaryButton>
        </div>
        <p className="mt-3.5 text-[0.86rem] text-[#59655f]">
          Prices in CAD, flat monthly. Cancel anytime. Processor fees for rent
          collection are separate and pass straight through.
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
  ribbon?: string;
}[] = [
  {
    name: "Free",
    price: "$0",
    priceNote: "/ month",
    body: "Fill one vacancy at a time. Post the page, collect inquiries, and book viewings. No card needed.",
    includes: [
      "One live rental page",
      "Inquiries and viewing bookings in one list",
      "Email replies and reminders (no texting)",
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Growth",
    price: "$99",
    priceNote: "/ month",
    body: "The plan for a landlord who wants to stop chasing rent. Everything in Free, plus automatic rent collection and full tenant management.",
    includes: [
      "Unlimited live rentals",
      "Automatic rent collection (Stripe / Rotessa)",
      "Tenant records and payment ledger",
      "Renter screening, plus email and text",
      "Listing distribution and year-end tax export",
    ],
    cta: "Choose Growth",
    href: "/signup",
    featured: true,
    ribbon: "Most popular",
  },
  {
    name: "Premium",
    price: "$249",
    priceNote: "/ month",
    body: "For a portfolio. Everything in Growth, plus your books, repairs, and automatic reminders in one place.",
    includes: [
      "Everything in Growth",
      "Full accounting and live bank feed",
      "Maintenance and repair dispatch",
      "Automatic reminders and priority support",
    ],
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
            them, collect the rent, and keep the books without the chaos, now
            opened up for other small landlords.&quot;
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
            Ready to run your rentals in one place?
          </h2>
          <p className="mt-2.5 max-w-[42ch] text-[#cfe0d8]">
            Start free with one rental. Add automatic rent collection on Growth
            when you and your tenant are ready.
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
          Rent collection, rental pages, viewings, tenant records, and reports.
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
