import Link from "next/link";
import type { ReactNode } from "react";
import { VacantlessMark } from "../../components/vacantless-mark";

export const metadata = {
  title: "Terms of Service - Vacantless",
  description:
    "The terms that govern use of the Vacantless leasing workspace, including billing and cancellation.",
};

// Best-guess operator + address (confirm at legal review; swap the street in
// when you have it).
const LEGAL_ENTITY = "Agile Real Estate Group";
const MAILING_ADDRESS = "Windsor, Ontario, Canada";
const GOVERNING_LAW = "the Province of Ontario, Canada";
const LAST_UPDATED = "July 3, 2026";
const CONTACT_EMAIL = "hello@vacantless.com";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <LegalHeader />
      <main className="mx-auto w-[min(820px,calc(100%-32px))] py-14">
        <h1 className="text-[clamp(2rem,4vw,2.8rem)] font-extrabold tracking-tight">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-[#59655f]">Last updated: {LAST_UPDATED}</p>

        <P>
          These Terms govern your use of the Vacantless leasing workspace and
          website (the &quot;Service&quot;), operated by {LEGAL_ENTITY}{" "}
          (&quot;Vacantless,&quot; &quot;we,&quot; &quot;us&quot;). By creating an
          account or using the Service, you agree to these Terms.
        </P>

        <H2>The Service</H2>
        <P>
          Vacantless helps landlords post rentals, share them, coordinate
          viewings, track inquiries, and record tenancies and rent. It is a
          software tool. It is not legal, financial, tax, or property-management
          advice, and it does not guarantee any leasing outcome.
        </P>

        <H2>Accounts</H2>
        <P>
          You must be at least 18 and provide accurate information. You are
          responsible for activity under your account and for keeping your
          credentials secure. Notify us promptly of any unauthorized use.
        </P>

        <H2>Acceptable use</H2>
        <List
          items={[
            "Use the Service only for lawful leasing purposes.",
            "Do not upload unlawful content, infringe others' rights, or misuse other people's personal information.",
            "Do not attempt to disrupt, reverse engineer, or gain unauthorized access to the Service.",
          ]}
        />

        <H2>Landlord responsibilities</H2>
        <P>
          You are solely responsible for complying with all laws that apply to
          your rentals, including landlord-tenant, privacy, and human-rights and
          fair-housing law. You are responsible for the accuracy of your listings
          and for having a lawful basis to collect and enter renter information.
        </P>

        <H2>Payments and rent collection</H2>
        <P>
          Vacantless is not a bank, money transmitter, or payment processor and
          never holds your funds. Where you collect rent through the Service, the
          payment is processed by a third party (Stripe, or Rotessa where you
          connect it), you are the merchant of record, and funds settle directly
          to you. Those processors charge their own fees, set and deducted by
          them; Vacantless adds no fee of its own on rent payments. Your use of a
          processor is subject to that processor&apos;s own terms. Any third-party
          service a renter uses to pay (for example, Chexy) is independent of
          Vacantless and governed by its own terms.
        </P>

        <H2>Subscriptions, billing, and cancellation</H2>
        <List
          items={[
            "Vacantless offers a Free plan and paid plans (Growth and Premium). Paid subscription fees are separate from any payment-processor fees.",
            "Paid plans are billed in advance on a recurring monthly basis until cancelled. Prices are in CAD unless stated otherwise.",
            "You can cancel at any time. Cancellation stops future billing; your paid access continues until the end of the current billing period.",
            "Except where required by law, subscription fees already paid are non-refundable, including for partial periods.",
            "We may change plan features or pricing with reasonable notice; changes take effect at your next billing period.",
          ]}
        />

        <H2>Third-party services</H2>
        <P>
          The Service integrates with third parties (for example, payment
          processors and email delivery). We are not responsible for third-party
          services, and your use of them is at your own risk and subject to their
          terms.
        </P>

        <H2>Disclaimers</H2>
        <P>
          The Service is provided &quot;as is&quot; and &quot;as available,&quot;
          without warranties of any kind, whether express or implied, to the
          fullest extent permitted by law.
        </P>

        <H2>Limitation of liability</H2>
        <P>
          To the fullest extent permitted by law, Vacantless will not be liable
          for indirect, incidental, special, or consequential damages, or for lost
          profits or lost data. Our total liability for any claim relating to the
          Service will not exceed the amounts you paid us for the Service in the 12
          months before the claim.
        </P>

        <H2>Indemnification</H2>
        <P>
          You agree to indemnify and hold Vacantless harmless from claims arising
          out of your use of the Service, your content, or your breach of these
          Terms or of applicable law.
        </P>

        <H2>Termination</H2>
        <P>
          You may stop using the Service at any time. We may suspend or terminate
          access if you breach these Terms or use the Service unlawfully. You can
          export or request your data as described in our{" "}
          <Link href="/privacy" className="font-semibold text-[#16756a] hover:underline">
            Privacy Policy
          </Link>
          .
        </P>

        <H2>Governing law</H2>
        <P>
          These Terms are governed by the laws of {GOVERNING_LAW}, without regard
          to conflict-of-laws rules, and the courts located there will have
          jurisdiction.
        </P>

        <H2>Changes</H2>
        <P>
          We may update these Terms from time to time. Material changes will be
          reflected by updating the date above and, where appropriate, notifying
          you. Continued use after changes means you accept them.
        </P>

        <H2>Contact</H2>
        <P>
          Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[#16756a] hover:underline">
            {CONTACT_EMAIL}
          </a>
          . Mailing address: {MAILING_ADDRESS}.
        </P>
      </main>
      <LegalFooter />
    </div>
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
