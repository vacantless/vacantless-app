import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vacantless Trade Terms",
};

// Block A2 of the Slice 0 redline (SLICE-0-TRADES-TOS-LIABILITY-CONSENT-2026-06-23.md):
// the full Vacantless Trade Terms a contractor agrees to when they accept a job
// on /job/[token]. These are VACANTLESS's terms (not the operator's), so the page
// is brand-neutral and self-contained — the /job accept step links here. Plain
// language, no em dashes (house style). NOT a substitute for legal review; the
// dogfood go-live runs on this copy with counsel review in parallel.

function Clause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-gray-900">
        {n}. {title}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{children}</p>
    </section>
  );
}

export default function TradeTermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vacantless</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Vacantless Trade Terms</h1>
        <p className="mt-1 text-xs text-gray-500">Last updated: June 23, 2026</p>

        <p className="mt-5 text-sm leading-relaxed text-gray-700">
          In short: Vacantless is a scheduling and messaging tool used by the property owner or
          manager who sent you this job. Vacantless is not the customer, is not hiring you, does not
          pay you, and is not a party to your agreement with the owner. You arrange payment and the
          work directly with the owner.
        </p>

        <Clause n={1} title="What Vacantless is">
          Vacantless is software used by property owners and property managers (&ldquo;Owners&rdquo;)
          to coordinate maintenance and repair work. When an Owner sends you a job through Vacantless,
          you are receiving a request from that Owner. Vacantless provides the messaging, quoting, and
          scheduling tools the two of you use to communicate. Vacantless is not a contractor, a general
          contractor, a broker of work, or an employer, and it does not direct, supervise, inspect, or
          guarantee any work.
        </Clause>

        <Clause n={2} title="Your relationship is with the Owner, not Vacantless">
          Any agreement to perform work, the price of that work, the scope, the schedule, warranties,
          and payment are strictly between you and the Owner. Vacantless is not a party to that
          agreement and has no obligation under it. Vacantless does not hire you and is not your
          customer.
        </Clause>

        <Clause n={3} title="Payment">
          Vacantless does not collect, hold, process, or pay any money. Any quote you submit through
          Vacantless is a number recorded for you and the Owner to communicate about; it is not a
          payment, an invoice processed by Vacantless, or a guarantee of payment. You are paid by the
          Owner directly, on terms you arrange with the Owner. Vacantless charges you nothing and owes
          you nothing.
        </Clause>

        <Clause n={4} title="You are an independent contractor">
          Nothing in your use of Vacantless creates an employment, agency, partnership, or
          joint-venture relationship between you and Vacantless. You are solely responsible for your
          own licensing, certifications, insurance, WSIB or workers&apos; compensation coverage where
          applicable, taxes, tools, safety, and compliance with all laws and codes that apply to your
          work.
        </Clause>

        <Clause n={5} title="Your responsibilities">
          You represent that you are qualified, licensed where required, and insured to perform the
          work you accept; that you will perform it to the applicable standard of care and code; and
          that you will deal honestly and promptly with the Owner. You are responsible for the quality,
          safety, and legality of your work.
        </Clause>

        <Clause n={6} title="Information you receive">
          A job link may include the job description, the property address or unit, contact details,
          and photos or video of the issue. This information is provided to you only to perform the
          job. You agree to use it solely for that purpose, to keep it confidential, not to share it,
          and to delete it when the job is complete. Do not use any of this information for marketing,
          resale, or any unrelated purpose.
        </Clause>

        <Clause n={7} title="Disclaimer and limitation of liability">
          Vacantless provides the coordination tools &ldquo;as is,&rdquo; without warranty of any kind.
          Vacantless is not responsible for the work itself, for any dispute between you and the Owner,
          for non-payment by the Owner, for the accuracy of any information an Owner or tenant
          provides, or for any loss, injury, or damage arising from the work or from your dealings with
          the Owner. To the maximum extent permitted by law, Vacantless&apos;s total liability to you in
          connection with the service is limited to zero, because you pay Vacantless nothing.
        </Clause>

        <Clause n={8} title="Indemnity">
          You agree to indemnify and hold harmless Vacantless and the Owner from claims arising out of
          your work, your negligence, or your breach of these Terms, to the extent permitted by law.
        </Clause>

        <Clause n={9} title="The link">
          Your job link is personal to you and to this job. Do not forward it. It expires after 60 days
          or when the job is closed.
        </Clause>

        <Clause n={10} title="Changes and contact">
          Vacantless may update these Terms; the version in effect is the one shown when you accept a
          job. Questions about a specific job should go to the Owner who sent it to you.
        </Clause>

        <p className="mt-8 border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-400">
          These Terms describe the relationship between you and Vacantless. They do not replace your
          agreement with the Owner for the work itself.
        </p>
      </main>
    </div>
  );
}
