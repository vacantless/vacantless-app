// S832 (PLAN-S829 item 4b): "what these jobs typically cost elsewhere", beside
// the Vacantless price. Rows, sources and dates live in lib/vendor-costs.ts.
// Shown on the homepage pricing and the billing page. A stacked list, not a
// table, so it reads at phone width.
import { TIERS, POSTING_ADDON } from "@/lib/billing";
import { VENDOR_COSTS, VENDOR_COSTS_HEAD, VENDOR_COSTS_NOTE, formatCheckedOn, type VendorCost } from "@/lib/vendor-costs";

function Row({ v }: { v: VendorCost }) {
  return (
    <li className="grid gap-1 border-b border-[#eef2ef] py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4">
      <span className="font-semibold text-[#15211d]">{v.job}</span>
      <span className="text-[#273832]">
        <span className="text-[#59655f]">In Vacantless: </span>
        {v.inVacantless}
      </span>
      <span className="sm:text-right">
        <span className="font-semibold text-[#15211d]">{v.typicalPrice}</span>
        <span className="block text-[0.76rem] leading-snug text-[#59655f]">
          <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#15211d]">
            {v.vendor}
          </a>
          , {formatCheckedOn(v.checkedOn)}
        </span>
      </span>
    </li>
  );
}

export function VendorCostTable({ className = "" }: { className?: string }) {
  const monthly = VENDOR_COSTS.filter((v) => v.kind === "monthly");
  const perJob = VENDOR_COSTS.filter((v) => v.kind === "per_job");
  const starter = TIERS.starter;
  return (
    <div id="pays-for-itself" className={`rounded-lg border border-[#d9e1dc] bg-white p-[22px] text-[0.86rem] ${className}`}>
      <h3 className="mb-1 text-[1.08rem] font-semibold text-[#15211d]">{VENDOR_COSTS_HEAD}</h3>
      <p className="mb-3 leading-snug text-[#59655f]">
        Every paid plan does these jobs; posting comes with the Posting add-on. {starter.name} is CA${Math.round(starter.priceCents / 100)} a month for up to {starter.rentalCap} rentals.
      </p>
      <p className="mt-2 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">Apps you would pay for each month</p>
      <ul className="list-none p-0">
        {monthly.map((v) => (
          <Row key={v.job} v={v} />
        ))}
      </ul>
      <p className="mt-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">Jobs you would pay for each time</p>
      <ul className="list-none p-0">
        {perJob.map((v) => (
          <Row key={v.job} v={v} />
        ))}
      </ul>
      <p className="mt-3 text-[0.78rem] leading-snug text-[#59655f]">
        {VENDOR_COSTS_NOTE} Posting is CA${Math.round(POSTING_ADDON.priceCents / 100)} a month.
      </p>
    </div>
  );
}
