import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VacantlessMark } from "../components/vacantless-mark";

export const metadata = {
  title: "Vacantless - Fill your next rental",
  description:
    "Create a rental page, share it safely, set viewing times, collect inquiries, and move the right renter into a tenancy record. A calm leasing workspace for small landlords.",
};

export const dynamic = "force-dynamic";

// Contact target for "get help launching" CTAs (brief: /signup primary, mailto
// secondary). Kept in one place so it is easy to swap for a help route later.
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
        <Workflow />
        <SafeSharing />
        <BuiltForOperators />
        <Pilot />
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
      className={`inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-lg border border-[#17362f] bg-[#17362f] px-4 text-[0.92rem] font-bold text-white shadow-[0_8px_18px_rgba(23,54,47,0.18)] transition hover:bg-[#1f463c] ${className}`}
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
      className={`inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-lg border border-[#d9e1dc] bg-white px-4 text-[0.92rem] font-bold text-[#203029] transition hover:bg-[#f4f7f5] ${className}`}
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
          <a href="#sharing" className="hover:text-[#15211d]">
            Safe sharing
          </a>
          <a href="#pilot" className="hover:text-[#15211d]">
            Pilot
          </a>
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
          <Eyebrow>Vacancy-to-tenancy leasing workspace</Eyebrow>
          <h1 className="mb-4 max-w-[11ch] text-[clamp(2.75rem,6vw,4.5rem)] font-extrabold leading-[0.98] tracking-tight">
            Fill your next rental
          </h1>
          <p className="mb-7 max-w-xl text-[clamp(1.08rem,1.8vw,1.28rem)] leading-relaxed text-[#384a42]">
            Create a rental page, share it safely, set viewing times, collect
            inquiries, and move the right renter into a tenancy record.
          </p>
          <div className="mb-7 flex flex-wrap items-center gap-3">
            <PrimaryButton href="/signup">{SIGNUP_LABEL}</PrimaryButton>
            <SecondaryButton href={CONTACT_HREF}>
              {CONTACT_LABEL}
            </SecondaryButton>
          </div>

          <div
            className="grid max-w-[520px] grid-cols-1 border-y border-[#d9e1dc] sm:grid-cols-3"
            aria-label="Current product scope"
          >
            {HERO_PROOFS.map((p, i) => (
              <div
                key={p.value}
                className={`py-3.5 sm:pr-4 ${
                  i < HERO_PROOFS.length - 1
                    ? "border-b border-[#d9e1dc] sm:border-b-0 sm:border-r"
                    : ""
                } ${i > 0 ? "sm:pl-4" : ""}`}
              >
                <span className="mb-1 block text-[1.01rem] font-extrabold leading-tight">
                  {p.value}
                </span>
                <span className="block text-[0.78rem] font-semibold leading-snug text-[#59655f]">
                  {p.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: product preview */}
        <ProductPreview />
      </div>
    </section>
  );
}

const HERO_PROOFS: { value: string; label: string }[] = [
  { value: "Rental page", label: "A shareable home base for one listing." },
  { value: "Viewing times", label: "Let renters book into windows you set." },
  {
    value: "Tenancy record",
    label: 'Keep the handoff after "yes" in one place.',
  },
];

/* The hero product preview — a tangible dashboard so a landlord sees what the
   product actually does. Real app concepts (rental status, task tiles, inquiry
   list, renter viewing picker), no rent-collection/accounting claims. */
function ProductPreview() {
  return (
    <div className="relative min-h-[520px] lg:pl-6">
      {/* Main dashboard screen */}
      <div className="relative z-[2] ml-auto w-full max-w-[670px] overflow-hidden rounded-lg border border-[#a4b5ac]/85 bg-white shadow-[0_16px_44px_rgba(28,43,36,0.14)]">
        <div className="flex min-h-[52px] items-center justify-between border-b border-[#d9e1dc] bg-[#fbfcfb] px-4">
          <span className="text-[0.86rem] font-extrabold">506 Manning Ave</span>
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
                  n.active
                    ? "bg-[#e2f0ea] text-[#174c42]"
                    : "text-[#59655f]"
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
                  506 Manning Ave, Main Floor
                </p>
                <p className="text-[0.82rem] leading-snug text-[#59655f]">
                  $4,018.33 / mo · 2 bed · 1 bath · available Aug 1
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
          <div className="grid gap-2.5">
            <div className="h-[11px] w-[78%] rounded-full bg-[#e3ebe6]" />
            <div className="h-[11px] rounded-full bg-[#e3ebe6]" />
            <div className="h-[11px] w-[62%] rounded-full bg-[#e3ebe6]" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
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
    body: "Evening and weekend windows are available to book.",
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

/* ---------------------------------------------------------------- Section head */

function SectionHead({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-6">
      <h2 className="max-w-[12ch] text-[clamp(1.9rem,4vw,3rem)] font-extrabold leading-[1.04]">
        {title}
      </h2>
      <p className="max-w-[34rem] text-base leading-relaxed text-[#59655f]">
        {children}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ Workflow */

function Workflow() {
  return (
    <section id="workflow" className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="One rental, one path">
          Keep the leasing work around one vacancy in a single flow: prepare the
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
    title: "Create the rental page",
    body: "Enter the address, rent, core details, photos, and availability date.",
  },
  {
    title: "Know what is safe to share",
    body: "Draft, Live, Paused, and Leased states keep links honest.",
  },
  {
    title: "Open viewing windows",
    body: "Set times renters can book without turning the week into chaos.",
  },
  {
    title: "Work the inquiry list",
    body: "Track renter messages, booking activity, and follow-up in one view.",
  },
  {
    title: "Convert to tenancy",
    body: "Move the selected renter into the tenancy record when the lease is set.",
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
          <h2 className="mb-4 max-w-[12ch] text-[clamp(1.9rem,4vw,3rem)] font-extrabold leading-[1.04]">
            Share the right link at the right time
          </h2>
          <p className="text-base leading-relaxed text-[#59655f]">
            Vacantless gives landlords clarity: know when a rental page is
            private, accepting inquiries, paused, or no longer available.
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
    body: "Prepare copy and details before renters see the page.",
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

/* ------------------------------------------------------- Built for operators */

function BuiltForOperators() {
  return (
    <section className="py-16 sm:py-[76px]">
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Built for small operators">
          Vacantless is for landlords who need one practical place to run the
          leasing work around a live vacancy.
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          {OPERATOR_PANELS.map((p) => (
            <article
              key={p.title}
              className="min-h-[230px] rounded-lg border border-[#d9e1dc] bg-white p-5"
            >
              <h3 className="mb-2.5 text-[1.05rem] font-semibold">{p.title}</h3>
              <ul className="mt-4 grid list-none gap-2.5 p-0">
                {p.items.map((it) => (
                  <li
                    key={it}
                    className="flex items-start gap-2.5 text-[0.92rem] leading-snug text-[#405047]"
                  >
                    <span className="mt-[3px] h-3.5 w-3.5 flex-none rounded bg-[#1f8a5b]" />
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

const OPERATOR_PANELS: { title: string; items: string[] }[] = [
  {
    title: "Before the listing goes out",
    items: [
      "Prepare the rental page and core details.",
      "Keep draft listings private while they are still being checked.",
      "See when the rental is ready to accept renter inquiries.",
      "Set the viewing windows renters can choose from.",
    ],
  },
  {
    title: "Once renters respond",
    items: [
      "Keep inquiries and viewing activity beside the rental.",
      "Follow the renter from first message to booked viewing.",
      "Pause or close the public page when the rental is no longer available.",
      "Create the tenancy record when the right renter is chosen.",
    ],
  },
];

/* --------------------------------------------------------------------- Pilot */

function Pilot() {
  return (
    <section
      id="pilot"
      className="border-y border-[#d9e1dc] bg-[#f4f7f5] py-16 sm:py-[76px]"
    >
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <SectionHead title="Start with one rental">
          Launch a single rental page first, then add more live rentals when the
          workflow is working for you.
        </SectionHead>
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => (
            <article
              key={p.name}
              className={`min-h-[246px] rounded-lg border bg-white p-5 ${
                p.featured
                  ? "border-[#6ca58d] shadow-[0_12px_32px_rgba(32,92,66,0.12)]"
                  : "border-[#d9e1dc]"
              }`}
            >
              <h3 className="mb-2 text-[1.08rem] font-semibold">{p.name}</h3>
              <span className="my-3 block text-[1.9rem] font-extrabold leading-tight">
                {p.price}
                {p.priceNote ? (
                  <small className="text-[0.86rem] font-bold text-[#59655f]">
                    {" "}
                    {p.priceNote}
                  </small>
                ) : null}
              </span>
              <p className="mb-5 text-[0.92rem] leading-relaxed text-[#59655f]">
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
}[] = [
  {
    name: "Free",
    price: "$0",
    priceNote: "/ month",
    body: "Use one live rental page to collect inquiries and viewing bookings.",
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Guided pilot",
    price: "Setup help",
    body: "Work with Vacantless to launch a real rental and tune the flow.",
    cta: CONTACT_LABEL,
    href: CONTACT_HREF,
    featured: true,
  },
  {
    name: "Growth",
    price: "More rentals",
    body: "For operators who need more than one live rental at a time.",
    cta: "Choose Growth",
    href: "/signup",
  },
];

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
          <Link href="/login" className="hover:text-[#15211d]">
            Log in
          </Link>
          <Link href="/signup" className="font-semibold text-[#17362f] hover:underline">
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
