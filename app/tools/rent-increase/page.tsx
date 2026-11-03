import { createAdminClient } from "@/lib/supabase/admin";
import { mergeGuidelineRows } from "@/lib/guideline-server";
import { ONTARIO_GUIDELINE } from "@/lib/rent-increase";
import { RentIncreaseTool } from "@/components/rent-increase-tool";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
} from "../../../components/marketing-chrome";

// S746: the free Ontario rent-increase calculator and Form N1 filler (engine 1
// of the subscriber plan). No sign-in. The same engine the signed-in product
// runs (lib/rent-increase.ts) and the same official-form fill (lib/n1-official-pdf.ts).

export const revalidate = 3600;

export const metadata = {
  title: "Ontario rent increase calculator 2027: new rent, dates and a filled Form N1",
  description:
    "Enter the rent and the move-in date. Get the 2027 guideline (1.9%), the new rent, the first legal day and the notice deadline, then download the official Form N1 filled in. Free, no sign-in.",
  alternates: { canonical: "https://www.vacantless.com/tools/rent-increase" },
};

const RULES: { title: string; body: string }[] = [
  {
    title: "Once every 12 months",
    body: "Rent can go up 12 months after the tenant moved in, or 12 months after the last increase, whichever is later.",
  },
  {
    title: "90 days of written notice",
    body: "The tenant must get Form N1 at least 90 days before the new rent starts. Serve it late and the start day moves, it never catches up.",
  },
  {
    title: "The guideline is the cap",
    body: "For most units the increase cannot be more than the yearly guideline. Anything higher needs the Landlord and Tenant Board's approval first.",
  },
  {
    title: "Newer units are not capped",
    body: "A unit first lived in after November 15, 2018 is exempt from the guideline. The 12-month and 90-day rules still apply.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is the Ontario rent increase guideline for 2027?",
    a: "1.9%. It applies to increases that start between January 1 and December 31, 2027. The 2026 guideline was 2.1%.",
  },
  {
    q: "Which date do I count from?",
    a: "The later of the move-in date and the last increase. If you have never raised the rent, use the day the tenant moved in.",
  },
  {
    q: "Can I round the new rent up?",
    a: "No. The increase cannot be more than the guideline percent of the current rent. Rounding down is fine.",
  },
  {
    q: "Is the downloaded form the real one?",
    a: "Yes. It is the Landlord and Tenant Board's Form N1 (v. 01/04/2022) with your numbers filled into the official fields. Sign it, keep a copy, and give it to the tenant.",
  },
];

async function loadGuidelineMap(): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  for (const [year, pct] of Object.entries(ONTARIO_GUIDELINE)) map[year] = pct;
  const admin = createAdminClient();
  if (!admin) return map;
  try {
    const { data } = await admin.from("rent_guidelines").select("year, percent");
    for (const [year, pct] of mergeGuidelineRows(data ?? [])) map[String(year)] = pct;
  } catch {
    // The shipped table is the safety net.
  }
  return map;
}

function todayInToronto(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function RentIncreaseToolPage() {
  const guideline = await loadGuidelineMap();
  const today = todayInToronto();
  const years = Object.keys(guideline)
    .map(Number)
    .filter((y) => y >= 2024)
    .sort((a, b) => b - a);

  return (
    <div className="min-h-screen bg-white text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Free tool for Ontario landlords
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              Ontario rent increase calculator, with the Form N1 filled in.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Enter the rent and the move-in date. You get the new rent under this year&apos;s
              guideline, the first legal day, the notice deadline, and the official N1 ready to
              sign. No account needed.
            </p>
          </div>
        </section>

        <section className="py-10">
          <div className="mx-auto w-[min(1100px,calc(100%-32px))]">
            <RentIncreaseTool guideline={guideline} today={today} />
          </div>
        </section>

        <section className="border-t border-[#d9e1dc] bg-[#f6faf7] py-12">
          <div className="mx-auto w-[min(1000px,calc(100%-32px))]">
            <h2 className="mb-6 text-[1.5rem] font-extrabold tracking-tight">The rules the tool applies</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {RULES.map((r) => (
                <div key={r.title} className="rounded-xl border border-[#d9e1dc] bg-white p-5">
                  <h3 className="mb-1.5 text-[1.02rem] font-extrabold">{r.title}</h3>
                  <p className="text-[0.95rem] leading-relaxed text-[#384a42]">{r.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full max-w-[520px] border-collapse text-[0.95rem]">
                <caption className="mb-2 text-left font-extrabold">Ontario rent increase guideline by year</caption>
                <thead>
                  <tr className="border-b border-[#d9e1dc] text-left text-[#59655f]">
                    <th className="py-2 pr-4 font-bold">Year the increase starts</th>
                    <th className="py-2 font-bold">Guideline</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y} className="border-b border-[#eef2ef]">
                      <td className="py-2 pr-4">{y}</td>
                      <td className="py-2 font-bold">{guideline[String(y)]}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[0.82rem] text-[#59655f]">
                Source: Ontario Ministry of Municipal Affairs and Housing,{" "}
                <a
                  className="underline hover:text-[#15211d]"
                  href="https://www.ontario.ca/page/residential-rent-increases"
                  target="_blank"
                  rel="noopener"
                >
                  Residential rent increases
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-6 text-[1.5rem] font-extrabold tracking-tight">Common questions</h2>
            <dl className="grid gap-5">
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt className="text-[1.02rem] font-extrabold">{f.q}</dt>
                  <dd className="mt-1 text-[0.95rem] leading-relaxed text-[#384a42]">{f.a}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[0.86rem] text-[#59655f]">
              This page explains the rules in plain words and fills a government form from the
              numbers you enter. It is not legal advice. For an increase above the guideline, or
              any dispute, talk to the Landlord and Tenant Board or a paralegal.
            </p>
          </div>
        </section>

        <MarketingCta
          title="Fill your next vacancy the same easy way."
          body="Vacantless is the leasing tool built by working landlords. Renters book their own viewings, every inquiry lands in one list, and the rent-increase reminder is free for one rental."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
