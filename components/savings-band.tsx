// S835g: the price comparison, near the top of the homepage. The full list
// with every source stays in Pricing (components/vendor-cost-table.tsx); this
// is its headline. Same rules as the table (Noam 2026-11-22): typical list
// prices, never "you will save", the monthly apps are the only thing added
// up, and the property manager line stands beside the total, never inside it.
import { TIERS } from "@/lib/billing";
import { VENDOR_COSTS, cadPriceText, exampleText, monthlySubtotalCad } from "@/lib/vendor-costs";

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function SavingsBand() {
  const monthly = VENDOR_COSTS.filter((v) => v.kind === "monthly");
  const manager = VENDOR_COSTS.find((v) => v.kind === "share_of_rent") ?? null;
  const sub = monthlySubtotalCad();
  const starter = TIERS.starter;
  const starterPrice = `CA$${Math.round(starter.priceCents / 100)}`;
  const count = NUMBER_WORDS[monthly.length] ?? String(monthly.length);
  const managerExample = manager ? exampleText(manager) : null;
  return (
    <section id="what-it-replaces" className="border-b border-[#d9e1dc] bg-[#f4f7f5] py-12 sm:py-14">
      <div className="mx-auto w-[min(1160px,calc(100%-32px))]">
        <h2 className="mb-2 text-[clamp(1.5rem,2.8vw,2.1rem)] font-extrabold leading-tight">What it replaces</h2>
        <p className="mb-6 max-w-[40rem] text-base leading-relaxed text-[#59655f]">
          Typical list prices for the apps a landlord pays for one by one, beside one Vacantless plan.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-[#d9e1dc] bg-white p-[22px]">
            <p className="text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#59655f]">{count} separate apps</p>
            <p className="mt-1 text-[clamp(1.7rem,3.2vw,2.3rem)] font-extrabold leading-tight text-[#15211d]">
              CA${sub.low} to CA${sub.high}
            </p>
            <p className="text-[0.95rem] text-[#59655f]">a month, about</p>
            <ul className="mt-3 list-none space-y-1 p-0 text-[0.92rem] text-[#273832]">
              {monthly.map((v) => (
                <li key={v.job} className="flex items-baseline justify-between gap-3">
                  <span>{v.job}</span>
                  <span className="whitespace-nowrap text-[#59655f]">{cadPriceText(v).replace(" a month", "")}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border-2 border-[var(--color-primary)] bg-white p-[22px]">
            <p className="text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">Vacantless {starter.name}</p>
            <p className="mt-1 text-[clamp(1.7rem,3.2vw,2.3rem)] font-extrabold leading-tight text-[#15211d]">{starterPrice}</p>
            <p className="text-[0.95rem] text-[#59655f]">a month, up to {starter.rentalCap} rentals</p>
            <p className="mt-3 text-[0.92rem] leading-relaxed text-[#273832]">
              Every paid plan does all {monthly.length} jobs. Free for one rental, and no card to start.
            </p>
          </div>
        </div>
        {manager && (
          <p className="mt-4 max-w-[52rem] text-[0.95rem] leading-relaxed text-[#273832]">
            <span className="font-semibold text-[#15211d]">Or a property manager to find tenants and collect rent:</span>{" "}
            {cadPriceText(manager)}
            {managerExample ? `. On ${managerExample}` : ""}. Showings and visits in person stay with you.
          </p>
        )}
        <p className="mt-3 text-[0.9rem]">
          <a href="#pays-for-itself" className="font-semibold text-[#15211d] underline">
            See every price and where it comes from
          </a>
        </p>
      </div>
    </section>
  );
}
