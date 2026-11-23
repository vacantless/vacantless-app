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

// S835g: the table read like fine print (small grey text, three lines of source
// under every price). Now: the comparison first and large, plain rows of job
// and price, and every source in one list that opens. Nothing about the rules
// changed: monthly apps are the only thing added up.
function Row({ v }: { v: VendorCost }) {
  const example = exampleText(v);
  return (
    <li className="grid gap-1 border-b border-[#eef2ef] py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)] sm:items-baseline sm:gap-6">
      <span>
        <span className="block font-semibold text-[#15211d]">{v.job}</span>
        <span className="block text-[0.9rem] leading-snug text-[#59655f]">In Vacantless: {v.inVacantless}</span>
      </span>
      <span className="sm:text-right">
        <span className="font-semibold text-[#15211d]">{cadPriceText(v)}</span>
        {example ? <span className="block text-[0.86rem] text-[#273832]">{example}</span> : null}
      </span>
    </li>
  );
}

function Group({ label, rows }: { label: string; rows: VendorCost[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className="mt-5 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent)]">{label}</p>
      <ul className="list-none p-0">
        {rows.map((v) => (
          <Row key={v.job} v={v} />
        ))}
      </ul>
    </>
  );
}

export function VendorCostTable({
  className = "",
  rowsFolded = false,
}: {
  className?: string;
  /** S835g: the homepage is long, so it shows the comparison and folds the rows. */
  rowsFolded?: boolean;
}) {
  const monthly = VENDOR_COSTS.filter((v) => v.kind === "monthly");
  const perJob = VENDOR_COSTS.filter((v) => v.kind === "per_job");
  // S834b: a manager's cut of the rent; not a monthly app, never summed.
  const shareOfRent = VENDOR_COSTS.filter((v) => v.kind === "share_of_rent");
  const sub = monthlySubtotalCad();
  const starter = TIERS.starter;
  const starterPrice = `CA$${Math.round(starter.priceCents / 100)}`;
  const rows = (
    <>
      <Group label="Apps you would pay for each month" rows={monthly} />
      <Group label="Jobs you would pay for each time" rows={perJob} />
      <Group label="Or someone you would pay from the rent" rows={shareOfRent} />
    </>
  );
  return (
    <div id="pays-for-itself" className={`scroll-mt-24 rounded-lg border border-[#d9e1dc] bg-white p-[22px] text-[0.95rem] ${className}`}>
      <h3 className="mb-1 text-[1.2rem] font-semibold text-[#15211d]">{VENDOR_COSTS_HEAD}</h3>
      <p className="mb-4 leading-snug text-[#59655f]">
        Every paid plan does these jobs; posting every rental comes with the Posting add-on. Prices in Canadian dollars.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-[#f4f7f5] px-4 py-3">
          <span className="block text-[0.86rem] text-[#59655f]">These apps together</span>
          <span className="block text-[1.5rem] font-extrabold leading-tight text-[#15211d]">
            about CA${sub.low} to CA${sub.high}
          </span>
          <span className="block text-[0.86rem] text-[#59655f]">a month</span>
        </div>
        <div className="rounded-md border border-[var(--color-primary)] px-4 py-3">
          <span className="block text-[0.86rem] text-[#59655f]">Vacantless {starter.name}</span>
          <span className="block text-[1.5rem] font-extrabold leading-tight text-[#15211d]">{starterPrice}</span>
          <span className="block text-[0.86rem] text-[#59655f]">a month, up to {starter.rentalCap} rentals</span>
        </div>
      </div>
      {rowsFolded ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-[#15211d] underline">See each job and its price</summary>
          {rows}
        </details>
      ) : (
        rows
      )}
      <p className="mt-3 text-[0.86rem] leading-snug text-[#59655f]">
        Per-job prices are not added up, since how often you need them varies. Posting is CA${Math.round(POSTING_ADDON.priceCents / 100)} a month.
      </p>
      <details className="mt-3 rounded-md border border-[#eef2ef] px-3 py-2 text-[0.86rem] text-[#59655f]">
        <summary className="cursor-pointer font-semibold text-[#15211d]">Where these prices come from</summary>
        <ul className="mt-2 list-none space-y-1.5 p-0 leading-snug">
          {VENDOR_COSTS.map((v) => (
            <li key={v.job}>
              <span className="text-[#273832]">{v.job}:</span> {v.typicalPrice},{" "}
              <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#15211d]">
                {v.vendor}
              </a>
              , {formatCheckedOn(v.checkedOn)}
            </li>
          ))}
        </ul>
        <p className="mt-2 leading-snug">
          {VENDOR_COSTS_NOTE} US prices converted at the{" "}
          <a href={USD_CAD.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#15211d]">
            Bank of Canada
          </a>{" "}
          rate of {USD_CAD.rate} on {formatCheckedOn(USD_CAD.date)}.
        </p>
      </details>
    </div>
  );
}
