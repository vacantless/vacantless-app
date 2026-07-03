import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VacantlessMark } from "../components/vacantless-mark";

export const metadata = {
  title: "Vacantless - Catch every rental opportunity",
  description:
    "One simple place to collect rental inquiries, reply fast, let renters book their own viewings, and turn interest into signed leases.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  // Logged-in visitors skip the public marketing page and go straight to their
  // dashboard; logged-out visitors see the landing page below.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SiteHeader />
      <main>
        <Hero />
        <OpportunityBand />
        <HowItWorks />
        <EverythingInOnePlace />
        <WhoItIsFor />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ Header */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Wordmark />
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-gray-600 transition hover:text-gray-900 sm:inline-block"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-gradient-to-r from-indigo-600 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            Start a 30-day pilot
          </Link>
        </div>
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <VacantlessMark variant="black" className="h-7 w-7" />
      <span className="text-lg font-bold tracking-tight text-gray-900">
        Vacantless
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------- Hero */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* layered background for depth */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-50 via-white to-white" />
        <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl" />
        <div className="absolute right-0 top-10 h-96 w-96 rounded-full bg-teal-300/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-violet-200/30 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-2">
        {/* Left: copy */}
        <div>
          <VacantlessMark variant="gradient" className="mb-5 h-12 w-12" />
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-teal-500" />
            Vacantless
          </p>
          <h1 className="text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-[3.25rem]">
            Catch every{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-teal-500 bg-clip-text text-transparent">
              rental opportunity
            </span>
            .
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
            Vacantless gives you one simple place to collect rental inquiries,
            reply fast, let renters book their own viewing times, and turn
            interest into signed leases.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-teal-500 px-5 py-3 font-semibold text-white shadow-md transition hover:opacity-90"
            >
              Start a 30-day pilot
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Log in
            </Link>
          </div>

          {/* graphic proof strip */}
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {PROOFS.map((p) => (
              <span
                key={p.label}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-600"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-brand">
                  {p.icon}
                </span>
                {p.label}
              </span>
            ))}
          </div>
        </div>

        {/* Right: product preview */}
        <div className="relative">
          {/* glowing halo behind the mockup for pizazz */}
          <div className="pointer-events-none absolute inset-0 -z-10 mx-auto h-full w-full max-w-md rounded-[2rem] bg-gradient-to-tr from-indigo-200/50 to-teal-200/50 blur-2xl" />
          <RenterListMockup />
        </div>
      </div>
    </section>
  );
}

const PROOFS: { label: string; icon: ReactNode }[] = [
  { label: "Reply in seconds", icon: <BoltIcon /> },
  { label: "One link to share", icon: <LinkIcon /> },
  { label: "Every renter tracked", icon: <CheckIcon /> },
];

/* The hero product mockup — a tangible "renter list" so a landlord can see
   what the product actually does without any jargon. */
function RenterListMockup() {
  return (
    <div className="relative mx-auto max-w-md">
      {/* floating accent card */}
      <div className="absolute -right-3 -top-5 z-10 hidden rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-lg sm:block">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-700">
            <CheckIcon />
          </span>
          <div>
            <p className="text-xs font-semibold text-gray-900">Viewing booked</p>
            <p className="text-[11px] text-gray-500">Saturday, 2:00 PM</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-xl">
        {/* window chrome */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            Your renter list
          </span>
        </div>

        <div className="divide-y divide-gray-100">
          {MOCK_RENTERS.map((r) => (
            <div key={r.name} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${r.avatarClass}`}
              >
                {r.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {r.name}
                </p>
                <p className="truncate text-xs text-gray-500">{r.detail}</p>
              </div>
              <StatusPill tone={r.tone}>{r.status}</StatusPill>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MOCK_RENTERS: {
  name: string;
  initials: string;
  detail: string;
  status: string;
  tone: PillTone;
  avatarClass: string;
}[] = [
  {
    name: "Maria S.",
    initials: "MS",
    detail: "Wants to move in by Aug 1",
    status: "New inquiry",
    tone: "blue",
    avatarClass: "bg-indigo-100 text-brand",
  },
  {
    name: "James T.",
    initials: "JT",
    detail: "Viewing Sat at 2:00 PM",
    status: "Booked",
    tone: "teal",
    avatarClass: "bg-teal-100 text-teal-700",
  },
  {
    name: "Priya K.",
    initials: "PK",
    detail: "Replied 2 days ago",
    status: "Follow-up",
    tone: "amber",
    avatarClass: "bg-amber-100 text-amber-700",
  },
  {
    name: "Daniel O.",
    initials: "DO",
    detail: "Application received",
    status: "Applied",
    tone: "violet",
    avatarClass: "bg-violet-100 text-violet-700",
  },
  {
    name: "The Nguyen family",
    initials: "TN",
    detail: "Lease signed",
    status: "Leased",
    tone: "green",
    avatarClass: "bg-emerald-100 text-emerald-700",
  },
];

/* ------------------------------------------------------------- Opportunity band */

function OpportunityBand() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-r from-indigo-600 to-teal-500">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-10 top-0 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-10 right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
      </div>
      <div className="relative mx-auto max-w-4xl px-6 py-14 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Make the most of every renter who reaches out.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">
          Every call, message, and inquiry from Facebook Marketplace, Kijiji,
          email, and text lands in one place, gets a fast reply, and stays on
          your list until the unit is leased.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- How it works */

function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-gray-900">
          How it works
        </h2>
        <p className="mt-3 text-lg text-gray-600">
          Three simple pieces. No technical setup.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-teal-500 text-white shadow-sm">
                {s.icon}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Step {i + 1}
              </span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              {s.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {s.body}
            </p>
            <div className="mt-5 flex-1">{s.preview}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STEPS: {
  title: string;
  body: string;
  icon: ReactNode;
  preview: ReactNode;
}[] = [
  {
    title: "Your rental inquiry page",
    body: "Share one simple link. Renters ask about the unit, leave their contact details, and tell you when they want to move.",
    icon: <PageIcon />,
    preview: (
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-teal-500 px-3 py-2">
          <span className="h-4 w-4 rounded bg-white/70" />
          <span className="text-xs font-bold text-white">
            Riverside Apartments
          </span>
        </div>
        <div className="space-y-2 p-3">
          <div className="h-2 w-3/4 rounded bg-gray-200" />
          <div className="h-2 w-1/2 rounded bg-gray-200" />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="h-7 rounded border border-gray-200 bg-gray-50" />
            <div className="h-7 rounded border border-gray-200 bg-gray-50" />
          </div>
          <div className="mt-1 h-8 rounded-lg bg-gradient-to-r from-indigo-600 to-teal-500" />
        </div>
      </div>
    ),
  },
  {
    title: "Your renter list",
    body: "See every interested renter in one place: new, contacted, booked, showed, applied, or leased.",
    icon: <ListIcon />,
    preview: (
      <div className="space-y-2 rounded-xl border border-gray-200 p-3">
        {[
          { n: "w-2/3", tone: "bg-indigo-100 text-brand", t: "New" },
          { n: "w-1/2", tone: "bg-teal-100 text-teal-700", t: "Booked" },
          { n: "w-3/5", tone: "bg-amber-100 text-amber-700", t: "Follow-up" },
        ].map((row) => (
          <div key={row.t} className="flex items-center gap-2">
            <span className="h-6 w-6 shrink-0 rounded-full bg-gray-100" />
            <span className={`h-2 rounded bg-gray-200 ${row.n}`} />
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.tone}`}
            >
              {row.t}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Viewing times",
    body: "Set your available times. Renters choose a viewing without all the back-and-forth.",
    icon: <CalendarIcon />,
    preview: (
      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-2 text-[11px] font-medium text-gray-400">
          Saturday
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {["10:00", "10:30", "11:00", "1:30", "2:00", "2:30"].map((t, i) => (
            <div
              key={t}
              className={`rounded-md px-1 py-1.5 text-center text-[11px] font-medium ${
                i === 4
                  ? "bg-gradient-to-r from-indigo-600 to-teal-500 text-white shadow-sm"
                  : "border border-gray-200 text-gray-600"
              }`}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

/* -------------------------------------------------------- Everything in one place */

function EverythingInOnePlace() {
  return (
    <section className="bg-gray-50 py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">
            Everything in one place
          </h2>
          <p className="mt-3 text-lg text-gray-600">
            From the first message to the signed lease, Vacantless keeps every
            opportunity moving forward.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {WINS.map((w) => (
            <div
              key={w.title}
              className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-teal-500 text-white">
                {w.icon}
              </span>
              <div>
                <h3 className="font-semibold text-gray-900">{w.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {w.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const WINS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "One inquiry page renters fill out",
    body: "Share a single link everywhere you post. Every interested renter comes in the same clean way.",
    icon: <PageIcon />,
  },
  {
    title: "Fast, automatic replies",
    body: "Renters hear back right away, so you stay top of the list while their interest is fresh.",
    icon: <BoltIcon />,
  },
  {
    title: "Renters book their own viewings",
    body: "Set your available times once. Renters pick a slot, with no back-and-forth messaging.",
    icon: <CalendarIcon />,
  },
  {
    title: "An organized renter list",
    body: "See everyone at a glance, from new inquiry to signed lease, and know exactly who needs follow-up.",
    icon: <ListIcon />,
  },
];

/* ----------------------------------------------------------------- Who it's for */

function WhoItIsFor() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-gray-900">
          Who it&apos;s for
        </h2>
        <p className="mt-3 text-lg text-gray-600">
          A simple system, without a big property-management platform.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {AUDIENCE.map((a) => (
          <div
            key={a.title}
            className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              {a.icon}
            </span>
            <div>
              <h3 className="font-semibold text-gray-900">{a.title}</h3>
              <p className="mt-1 text-sm text-gray-600">{a.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const AUDIENCE: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Small landlords",
    body: "Owners renting out a few units who want to catch every inquiry.",
    icon: <KeyIcon />,
  },
  {
    title: "Family-run portfolios",
    body: "Families managing several rentals who want everyone on the same page.",
    icon: <UsersIcon />,
  },
  {
    title: "Owners with multiple units",
    body: "Keep every unit's inquiries, viewings, and follow-ups organized.",
    icon: <BuildingIcon />,
  },
  {
    title: "Marketplace & Kijiji renters",
    body: "Already posting on Facebook, Kijiji, email, calls, and texts? Bring it all together.",
    icon: <ChatIcon />,
  },
];

/* -------------------------------------------------------------------- Final CTA */

function FinalCta() {
  return (
    <section className="px-6 pb-20">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-600 to-teal-500 px-6 py-14 text-center shadow-lg">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
          <div className="absolute -bottom-20 right-0 h-64 w-64 rounded-full bg-white/15 blur-2xl" />
        </div>
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to fill your next vacancy?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/90">
            Start a 30-day pilot and set up your first rental inquiry page in
            minutes.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-white px-6 py-3 font-semibold text-brand shadow-sm transition hover:bg-gray-50"
            >
              Start a 30-day pilot
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-white/50 px-6 py-3 font-medium text-white transition hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- Footer */

function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <Wordmark />
        <p className="text-sm text-gray-500">
          Faster replies. More viewings. Filled vacancies.
        </p>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-gray-500 hover:text-gray-900">
            Log in
          </Link>
          <Link
            href="/signup"
            className="font-medium text-brand hover:underline"
          >
            Start a pilot
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------- Status pill helper */

type PillTone = "blue" | "teal" | "amber" | "violet" | "green";

function StatusPill({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  const tones: Record<PillTone, string> = {
    blue: "bg-indigo-50 text-brand",
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    green: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Icons (inline,
   one consistent line style: 1.6 stroke, rounded) */

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="m5 12.5 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M9.5 14.5 14.5 9.5M10 6.5l1.2-1.2a4 4 0 0 1 5.7 5.7L15.5 12M14 17.5l-1.2 1.2a4 4 0 0 1-5.7-5.7L8.5 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <rect
        x="5"
        y="3"
        width="14"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 8h6M9 12h6M9 16h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M8 6h12M8 12h12M8 18h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="4" cy="6" r="1.3" fill="currentColor" />
      <circle cx="4" cy="12" r="1.3" fill="currentColor" />
      <circle cx="4" cy="18" r="1.3" fill="currentColor" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <rect
        x="4"
        y="5"
        width="16"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4 9h16M8 3v4M16 3v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14" r="1.6" fill="currentColor" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m11 11 8 8m-3-3 2-2m-4 0 2-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.5 19a5.5 5.5 0 0 1 11 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <rect
        x="5"
        y="3"
        width="14"
        height="18"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8 9.5h8M8 12.5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
