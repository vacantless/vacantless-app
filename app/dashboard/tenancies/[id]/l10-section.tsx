import { L1_FEE_PAPER_CENTS, L1_FEE_PORTAL_CENTS } from "@/lib/l1";
import { L10_PROBLEM_TEXT, type L10Problem } from "@/lib/l10";
import { formatMoneyCents } from "@/lib/payments";

// S751: "Prepare L10" (collect money a former tenant owes). The form posts to
// /dashboard/tenancies/[id]/l10/official, which counts the rent owing to the
// move-out date and returns the official 2026/09 L10 to sign and file.

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";

export function TenancyL10Section({
  tenancyId,
  endDate,
  landlordName,
  landlordPhone,
  depositCents,
  today,
  msg,
}: {
  tenancyId: string;
  endDate: string | null;
  landlordName: string;
  landlordPhone: string | null;
  depositCents: number | null;
  today: string;
  msg?: string;
}) {
  const problem = msg && msg in L10_PROBLEM_TEXT ? L10_PROBLEM_TEXT[msg as L10Problem] : null;
  const moveOutDefault = endDate && endDate <= today ? endDate : "";

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form L10: collect money a former tenant owes</h4>
      {problem && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{problem}</div>
      )}
      <p className="text-sm text-gray-600">
        For a tenant who has moved out, within one year of the move-out date. Vacantless fills the official 2026 L10
        with the rent owing up to the move-out date, plus any damage or other costs you enter. You sign it and file it on
        the{" "}
        <a href="https://tribunalsontario.ca/ltb/tribunals-ontario-portal/" target="_blank" rel="noopener noreferrer" className="underline">
          Tribunals Ontario Portal
        </a>{" "}
        ({formatMoneyCents(L1_FEE_PORTAL_CENTS)}) or on paper ({formatMoneyCents(L1_FEE_PAPER_CENTS)}), then give the
        former tenant the application and the Notice of Hearing at least 30 days before the hearing.
      </p>
      <form
        action={`/dashboard/tenancies/${tenancyId}/l10/official`}
        method="post"
        target="_blank"
        className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2"
      >
        <div>
          <label className={LABEL_CLS}>Date the tenant moved out</label>
          <input type="date" name="move_out" defaultValue={moveOutDefault} max={today} required className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>How you will file</label>
          <select name="method" defaultValue="portal" className={INPUT_CLS}>
            <option value="portal">Tribunals Ontario Portal ({formatMoneyCents(L1_FEE_PORTAL_CENTS)} fee)</option>
            <option value="paper">Mail, courier or ServiceOntario ({formatMoneyCents(L1_FEE_PAPER_CENTS)} fee)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS}>The former tenant&apos;s new address, if you know it (not the rental unit)</label>
          <input name="tenant_address" placeholder="e.g. 20 Ouellette Ave, Unit 4, Windsor, ON N9A 1A1" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Damage: repair or replacement cost (optional)</label>
          <input name="damage_cost" inputMode="decimal" placeholder="e.g. 850.00" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>What was damaged, and how you worked out the cost</label>
          <textarea name="damage_detail" rows={3} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Other out-of-pocket costs from serious interference (optional)</label>
          <input name="interference_cost" inputMode="decimal" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>What happened, and how the costs connect to it</label>
          <textarea name="interference_detail" rows={3} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Company name (if the landlord is a company)</label>
          <input name="landlord_company" defaultValue={landlordName} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Landlord first name</label>
          <input name="landlord_first" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Landlord last name</label>
          <input name="landlord_last" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Email</label>
          <input name="landlord_email" type="email" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Phone</label>
          <input name="landlord_phone" defaultValue={landlordPhone ?? ""} className={INPUT_CLS} />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS}>Your mailing address (street, unit, city, province, postal code)</label>
          <input name="landlord_address" placeholder="e.g. 100 King St W, Unit 5, Toronto, ON M5X 1A9" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>LTB can contact you by</label>
          <select name="by_email" defaultValue="yes" className={INPUT_CLS}>
            <option value="yes">Email</option>
            <option value="no">Mail</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Rent deposit you hold</label>
          <input
            name="deposit_amount"
            inputMode="decimal"
            defaultValue={depositCents ? (depositCents / 100).toFixed(2) : ""}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Date you collected the deposit</label>
          <input type="date" name="deposit_date" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Last deposit interest paid: from</label>
          <input type="date" name="interest_from" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>to</label>
          <input type="date" name="interest_to" className={INPUT_CLS} />
        </div>
        <div className="flex items-end">
          <button type="submit" className={BTN_PRIMARY}>
            Download official L10 (PDF)
          </button>
        </div>
        <p className="text-xs text-gray-500 sm:col-span-2">
          Rent is counted up to the move-out date: check the last row. NSF cheque charges and unpaid utilities need their own
          tables and bills; add those on the form yourself. Check each tenant&apos;s first and last name, and use the LTB&apos;s
          Schedule of Parties for more than 2 tenants.
        </p>
      </form>
    </div>
  );
}
