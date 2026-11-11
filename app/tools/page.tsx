import Link from "next/link";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
} from "../../components/marketing-chrome";

// S757: one page for every free tool. Each fills an official Ontario form with
// the same code the signed-in app uses. No sign-in.

export const metadata = {
  title: "Free tools for Ontario landlords: N4, N8, N12, rent increase and the Standard Lease",
  description:
    "Free, no sign-in tools that fill the Landlord and Tenant Board's official 2026 forms: N4 for unpaid rent, N8 for persistent late rent, N12 for own use or a buyer, the N1 rent increase and the Ontario Standard Lease.",
  alternates: { canonical: "https://www.vacantless.com/tools" },
};

const FREE_TOOLS: { href: string; form: string; title: string; body: string }[] = [
  {
    href: "/tools/n4",
    form: "Form N4",
    title: "Rent not paid",
    body: "The rent owing table and the 7-day termination date, mail and courier counted.",
  },
  {
    href: "/tools/n8",
    form: "Form N8",
    title: "Rent always late",
    body: "Checks the 3 times in 6 months rule and lists the late payments for you.",
  },
  {
    href: "/tools/n12",
    form: "Form N12",
    title: "You or a buyer need the unit",
    body: "The earliest valid end date and whether you owe one month's rent (the 120-day rule).",
  },
  {
    href: "/tools/rent-increase",
    form: "Form N1",
    title: "Raise the rent",
    body: "The 2026 and 2027 guideline, the 90-day notice and the 12-month rule.",
  },
  {
    href: "/tools/standard-lease",
    form: "Standard Lease (2229E)",
    title: "Sign a new tenant",
    body: "Ontario's required lease form, filled in and ready to sign.",
  },
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Free tools for Ontario landlords
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              The Board&apos;s forms, filled in for you.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Each tool works out the dates and amounts the Landlord and Tenant Board checks, then
              fills its current official form. Free, no account needed.
            </p>
          </div>
        </section>
        <section className="py-10">
          <div className="mx-auto grid w-[min(1000px,calc(100%-32px))] gap-4 sm:grid-cols-2">
            {FREE_TOOLS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="rounded-2xl border border-[#d9e1dc] bg-white p-5 transition hover:border-[#16756a] hover:shadow-sm"
              >
                <p className="text-[0.79rem] font-extrabold uppercase tracking-[0.06em] text-[#16756a]">{t.form}</p>
                <h2 className="mt-1 text-[1.2rem] font-extrabold tracking-tight">{t.title}</h2>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-[#384a42]">{t.body}</p>
                <p className="mt-3 text-[0.9rem] font-bold text-[#16756a]">Open the tool</p>
              </Link>
            ))}
          </div>
          <p className="mx-auto mt-6 w-[min(1000px,calc(100%-32px))] text-[0.86rem] text-[#59655f]">
            These tools explain the rules in plain words and fill government forms from the numbers
            you enter. They are not legal advice.
          </p>
        </section>
        <MarketingCta
          title="Fill your next vacancy the same easy way."
          body="Vacantless is the leasing tool built by working landlords. Renters book their own viewings, every inquiry lands in one list, and on any paid plan the Board forms are filled from the tenancy."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
