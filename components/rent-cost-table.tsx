// S807: what Stripe and Rotessa charge to collect rent, by number of rentals.
// Numbers live in lib/rent-rail-costs.ts (read from each provider's own page).
import {
  RAIL_COSTS_CHECKED,
  RAIL_COST_SOURCES,
  RAIL_TABLE_RENT_CENTS,
  RAIL_TABLE_ROWS,
  ROTESSA,
  STRIPE_PAD,
  dollars,
  monthlyRailCosts,
  rotessaCheaperFrom,
} from "@/lib/rent-rail-costs";

export function RentCostTable({ compact = false }: { compact?: boolean }) {
  const from = rotessaCheaperFrom(RAIL_TABLE_RENT_CENTS);
  return (
    <div className={compact ? "text-[0.84rem]" : "text-sm"}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#d9e1dc] text-[#59655f]">
            <th className="py-1.5 pr-3 font-semibold">Rentals</th>
            <th className="py-1.5 pr-3 font-semibold">Stripe a month</th>
            <th className="py-1.5 font-semibold">Rotessa a month</th>
          </tr>
        </thead>
        <tbody>
          {RAIL_TABLE_ROWS.map((n) => {
            const c = monthlyRailCosts(n, RAIL_TABLE_RENT_CENTS);
            const stripeWins = c.stripeCents <= c.rotessaCents;
            return (
              <tr key={n} className="border-b border-[#eef2ef]">
                <td className="py-1.5 pr-3">{n}</td>
                <td className={`py-1.5 pr-3 ${stripeWins ? "font-semibold text-[#15211d]" : "text-[#59655f]"}`}>{dollars(c.stripeCents)}</td>
                <td className={`py-1.5 ${!stripeWins ? "font-semibold text-[#15211d]" : "text-[#59655f]"}`}>{dollars(c.rotessaCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 leading-snug text-[#59655f]">
        One rent payment per rental a month. Stripe charges 1% + {dollars(STRIPE_PAD.fixedCents)} a payment, never more than {dollars(STRIPE_PAD.capCents)}.
        Rotessa charges {dollars(ROTESSA.monthlyCents)} a month + {dollars(ROTESSA.perPaymentCents)} a payment
        {from ? `, so it costs less from ${from} rentals` : ""}. A bounced payment costs {dollars(STRIPE_PAD.failedCents)} on Stripe, {dollars(ROTESSA.nsfCents)} on Rotessa.
        Each tenant&apos;s online bank check when they sign up costs {dollars(STRIPE_PAD.bankCheckCents)} once on Stripe, {dollars(ROTESSA.bankCheckCents)} on Rotessa.
        You pay them directly; Vacantless adds nothing. Prices from{" "}
        <a href={RAIL_COST_SOURCES.stripe} target="_blank" rel="noopener noreferrer" className="underline">
          Stripe&apos;s
        </a>{" "}
        and{" "}
        <a href={RAIL_COST_SOURCES.rotessa} target="_blank" rel="noopener noreferrer" className="underline">
          Rotessa&apos;s
        </a>{" "}
        pricing pages, {RAIL_COSTS_CHECKED}.
      </p>
    </div>
  );
}
