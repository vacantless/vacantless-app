import Link from "next/link";
import type { ReactNode } from "react";
import { VacantlessMark } from "../../components/vacantless-mark";

export const metadata = {
  title: "Data Deletion Instructions - Vacantless",
  description:
    "How to delete the Facebook Page and Instagram data connected to Vacantless, and your other personal information.",
};

const CONTACT_EMAIL = "hello@vacantless.com";
const LAST_UPDATED = "August 8, 2026";

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <LegalHeader />
      <main className="mx-auto w-[min(820px,calc(100%-32px))] py-14">
        <h1 className="text-[clamp(2rem,4vw,2.8rem)] font-extrabold tracking-tight">
          Data Deletion Instructions
        </h1>
        <p className="mt-2 text-sm text-[#59655f]">Last updated: {LAST_UPDATED}</p>

        <P>
          This page explains how to delete the data Vacantless holds, including
          the Facebook Page and Instagram Business account data you may have
          connected. For how we collect and use personal information generally,
          see our{" "}
          <Link href="/privacy" className="font-semibold text-[#16756a] hover:underline">
            Privacy Policy
          </Link>
          .
        </P>

        <H2>Delete your connected Facebook and Instagram data</H2>
        <P>
          If you connected a Facebook Business Page (and its linked Instagram
          Business account) to Vacantless, we store only the Page identity and
          access token and the linked Instagram account identifiers, so we can
          publish the posts you authorize. You can delete that connection at any
          time in either of these ways:
        </P>
        <List
          items={[
            "In Vacantless, open the property's Get online / distribution settings and disconnect the Facebook / Instagram channel. Disconnecting immediately deletes the stored Page access token and account identifiers.",
            "Or email us at hello@vacantless.com from the address on your account and ask us to remove your connected Facebook and Instagram data. We action these requests within 30 days.",
          ]}
        />
        <P>
          You can also remove Vacantless from your Facebook account at any time
          under Facebook Settings &rarr; Business Integrations, which revokes our
          access.
        </P>

        <H2>Delete your other personal information</H2>
        <P>
          To request deletion of the rest of your Vacantless account information,
          email {emailLink()} from the address on your account. If you are a
          renter whose information a landlord entered into Vacantless, please
          contact that landlord first; we will support their request.
        </P>

        <H2>Contact</H2>
        <P>
          Questions or deletion requests: {emailLink()}.
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
