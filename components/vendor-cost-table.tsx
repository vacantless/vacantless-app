// S832 (PLAN-S829 item 4b): "what these jobs typically cost elsewhere", beside
// the Vacantless price. Rows, sources and dates live in lib/vendor-costs.ts.
// Shown on the homepage pricing and the billing page. A stacked list, not a
// table, so it reads at phone width. S832c: one Canadian-dollar price per line
// (US prices converted at the dated Bank of Canada rate), the vendor's own
// price kept small under it, and a subtotal for the monthly apps only. Per-job
// lines are never summed or averaged (no usage data, Noam 2026-11-22).
import { TIERS, POSTING_ADDON } from "@/lib/billing";
import {
  USD_CAD,
  VENDOR_COSTS,
  VENDOR_COSTS_HEAD,
  VENDOR_COSTS_NOTE,
  cadPriceText,
  exampleText,
  formatCheckedOn,
  monthlySubtotalCad,
  type VendorCost,
} from "@/lib/vendor-costs";

function Row({ v }: { v: VendorCost }) {
  const example = exampleText(v);
  return (
    <li className="grid gap-1 border-b border-[#eef2ef] py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,200px)] sm:items-baseline sm:gap-4">
      <span className="font-semibold text-[#15211d]">{v.job}</span>
      <span className="text-[#273832]">
        <span className="text-[#59655f]">In Vacantless: </span>
        {v.inVacantless}
      </span>
      <span className="sm:text-right">
        <span className="font-semibold text-[#15211d]">{cadPriceText(v)}</span>
        {example ? <span className="block text-[0.8rem] text-[#273832]">{example}</span> : null}
        <span className="block text-[0.76rem] leading-snug text-[#59655f]">
          {v.typicalPrice},{" "}
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
  // S834b: a manager's cut of the rent; not a monthly app, never summed.
  const shareOfRent = VENDOR_COSTS.filter((v) => v.kind === "share_of_rent");
  const sub = monthlySubtotalCad();
  const starter = TIERS.starter;
  const starterPrice = `CA$${Math.round(starter.priceCents / 100)}`;
  return (
    <div id="pays-for-itself" className={`rounded-lg border border-[#d9e1dc] bg-white p-[22px] text-[0.86rem] ${className}`}>
      <h3 className="mb-1 text-[1.08rem] font-semibold text-[#15211d]">{VENDOR_COSTS_HEAD}</h3>
      <p className="mb-3 leading-snug text-[#59655f]">
        Every paid plan does these jobs; posting every rental comes with the Posting add-on. Prices in Canadian dollars.
      </p>
      <p className="mt-2 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">Apps you would pay for each month</p>
      <ul className="list-none p-0">
        {monthly.map((v) => (
          <Row key={v.job} v={v} />
        ))}
      </ul>
      <div className="mt-2 flex flex-col gap-1 rounded-md bg-[#f4f7f5] px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between">
        <span className="font-semibold text-[#15211d]">
          These apps together: about CA${sub.low} to CA${sub.high} a month
        </span>
        <span className="text-[#273832]">
          Vacantless {starter.name}: {starterPrice} a month, up to {starter.rentalCap} rentals
        </span>
      </div>
      <p className="mt-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">Jobs you would pay for each time</p>
      <ul className="list-none p-0">
        {perJob.map((v) => (
          <Row key={v.job} v={v} />
        ))}
      </ul>
      {shareOfRent.length > 0 && (
        <>
          <p className="mt-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">Or someone you would pay from the rent</p>
          <ul className="list-none p-0">
            {shareOfRent.map((v) => (
              <Row key={v.job} v={v} />
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-[0.78rem] leading-snug text-[#59655f]">
        {VENDOR_COSTS_NOTE} US prices converted at the{" "}
        <a href={USD_CAD.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#15211d]">
          Bank of Canada
        </a>{" "}
        rate of {USD_CAD.rate} on {formatCheckedOn(USD_CAD.date)}. Per-job prices are not added up, since how often you need them varies. Posting is CA${Math.round(POSTING_ADDON.priceCents / 100)} a month.
      </p>
    </div>
  );
}
