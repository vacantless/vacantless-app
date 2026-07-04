import Link from "next/link";
import type { ReactNode } from "react";
import { VacantlessMark } from "../../components/vacantless-mark";

export const metadata = {
  title: "Privacy Policy - Vacantless",
  description:
    "How Vacantless collects, uses, and protects personal information for landlords and their renters.",
};

// Best-guess operator + address (confirm at legal review; swap the street in
// when you have it).
const LEGAL_ENTITY = "Agile Real Estate Group";
const MAILING_ADDRESS = "Windsor, Ontario, Canada";
const LAST_UPDATED = "July 3, 2026";
const CONTACT_EMAIL = "hello@vacantless.com";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <LegalHeader />
      <main className="mx-auto w-[min(820px,calc(100%-32px))] py-14">
        <h1 className="text-[clamp(2rem,4vw,2.8rem)] font-extrabold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-[#59655f]">Last updated: {LAST_UPDATED}</p>

        <P>
          This Privacy Policy explains how {LEGAL_ENTITY} (&quot;Vacantless,&quot;
          &quot;we,&quot; &quot;us&quot;) collects, uses, discloses, and protects
          personal information when you use the Vacantless leasing workspace and
          website (the &quot;Service&quot;). We handle personal information in
          accordance with applicable Canadian privacy law, including PIPEDA.
        </P>

        <H2>Who this covers</H2>
        <P>
          Vacantless is used by landlords and property operators
          (&quot;landlords&quot;) to run their leasing. Landlords enter
          information about their rentals and about prospective and current
          renters. For that renter information, the landlord is the party
          responsible for it (the controller), and Vacantless processes it on the
          landlord&apos;s behalf to provide the Service.
        </P>

        <H2>Information we collect</H2>
        <List
          items={[
            "Account information: your name, business name, email, and login credentials.",
            "Rental information: addresses, rent, unit details, photos, and availability you enter.",
            "Renter and inquiry information that landlords enter or that renters submit: names, emails, phone numbers, messages, viewing bookings, and tenancy details.",
            "Payment information: when you use a rent rail, payments are processed by third parties (Stripe, Rotessa). Vacantless stores only processor identifiers and payment status. We never store bank account numbers, card numbers, credit reports, SINs, or government ID numbers.",
            "Usage and technical data: log data, device and browser information, and cookies needed to run the site and keep sessions secure.",
          ]}
        />

        <H2>How we use information</H2>
        <List
          items={[
            "Provide, maintain, and improve the Service.",
            "Schedule and record rent through the landlord's chosen processor, and send transactional emails, reminders, and receipts.",
            "Respond to support requests and communicate about the Service.",
            "Protect against fraud, abuse, and security risks, and comply with legal obligations.",
          ]}
        />
        <P>We do not sell personal information, and we do not use it for third-party advertising.</P>

        <H2>Service providers we share with</H2>
        <P>
          We share information only with providers that help us run the Service,
          under contracts that limit their use of it. These include our hosting
          and database provider, our email delivery providers, and the payment
          processors you choose to use (Stripe and, where applicable, Rotessa).
          Some of these providers operate in the United States, so information may
          be processed outside Canada.
        </P>

        <H2>How long we keep information</H2>
        <P>
          We keep information for as long as your account is active and as needed
          to provide the Service, then for a reasonable period to meet legal,
          accounting, and dispute-resolution needs, after which it is deleted or
          anonymized.
        </P>

        <H2>Security</H2>
        <P>
          We use industry-standard safeguards, including encryption in transit,
          access controls, and per-organization data isolation. No method of
          transmission or storage is perfectly secure, but we work to protect your
          information and to limit what we hold (for example, we deliberately do
          not store bank or card numbers).
        </P>

        <H2>Your choices and rights</H2>
        <P>
          Subject to applicable law, you may request access to, correction of, or
          deletion of your personal information, and you may withdraw consent for
          certain uses. If you are a renter whose information a landlord entered,
          please contact that landlord first; we will support their request. To
          make a request to us, email {emailLink()}.
        </P>

        <H2>Landlord responsibilities</H2>
        <P>
          Landlords are responsible for having a lawful basis to collect and share
          renter information they enter into Vacantless, and for handling it in
          line with applicable landlord-tenant, privacy, and human-rights law.
        </P>

        <H2>Cookies</H2>
        <P>
          We use only the cookies needed to operate the site and keep you signed
          in. We do not use advertising or cross-site tracking cookies.
        </P>

        <H2>Children</H2>
        <P>The Service is for business use by adults and is not directed to anyone under 18.</P>

        <H2>Changes</H2>
        <P>
          We may update this policy from time to time. Material changes will be
          reflected by updating the date above and, where appropriate, notifying
          you.
        </P>

        <H2>Contact</H2>
        <P>
          Questions or requests: {emailLink()}. Mailing address: {MAILING_ADDRESS}.
        </P>
      </main>
      <LegalFooter />
    </div>
  );
}

function emailLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[#16756a] hover:underline">
      {CONTACT_EMAIL}
    </a>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-relaxed text-[#384a42]">{children}</p>;
}

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1 mt-9 text-[1.3rem] font-extrabold tracking-tight">{children}</h2>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 grid list-none gap-3 p-0">
      {items.map((it) => (
        <li key={it} className="flex items-start gap-2.5 leading-snug text-[#384a42]">
          <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[#1f8a5b]" />
          {it}
        </li>
      ))}
    </ul>
  );
}

function LegalHeader() {
  return (
    <header className="border-b border-[#d9e1dc]">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between gap-4 py-3.5">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <VacantlessMark variant="black" className="h-[30px] w-[30px]" />
          <span className="text-[1.02rem] font-bold tracking-tight text-[#15211d]">
            Vacantless
          </span>
        </Link>
        <Link
          href="/signup"
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-[#17362f] bg-[#17362f] px-4 text-[0.9rem] font-bold text-white transition hover:bg-[#1f463c]"
        >
          Start free
        </Link>
      </div>
    </header>
  );
}

function LegalFooter() {
  return (
    <footer className="border-t border-[#d9e1dc] py-8 text-[0.86rem] text-[#59655f]">
      <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <Link href="/" className="font-semibold text-[#15211d]">
          Vacantless
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/about" className="hover:text-[#15211d]">About</Link>
          <Link href="/privacy" className="hover:text-[#15211d]">Privacy</Link>
          <Link href="/terms" className="hover:text-[#15211d]">Terms</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[#15211d]">{CONTACT_EMAIL}</a>
        </div>
      </div>
    </footer>
  );
}
