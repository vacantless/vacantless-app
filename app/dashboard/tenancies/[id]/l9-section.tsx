import { L1_FEE_PAPER_CENTS, L1_FEE_PORTAL_CENTS } from "@/lib/l1";
import { L9_PROBLEM_TEXT, type L9Problem } from "@/lib/l9";
import { formatMoneyCents } from "@/lib/payments";

// S751: "Prepare L9" (collect rent the tenant owes, tenant still living there).
// No notice first. The form posts to /dashboard/tenancies/[id]/l9/official,
// which counts the rent owing to the filing date and returns the official
// 2026/09 L9 for the landlord to sign and file.

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";

export function TenancyL9Section({
  tenancyId,
  active,
  owingTodayCents,
  ledgerProblem,
  landlordName,
  landlordPhone,
  today,
  msg,
}: {
  tenancyId: string;
  active: boolean;
  /** Rent owing up to today from the ledger, or null when it can't be counted. */
  owingTodayCents: number | null;
  /** The ledger problem that blocks an L9 today, if any. */
  ledgerProblem: L9Problem | null;
  landlordName: string;
  landlordPhone: string | null;
  today: string;
  msg?: string;
}) {
  const problem = msg && msg in L9_PROBLEM_TEXT ? L9_PROBLEM_TEXT[msg as L9Problem] : null;

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form L9: collect rent the tenant owes</h4>
      {problem && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{problem}</div>
      )}
      <p className="text-sm text-gray-600">
        Asks the LTB to order the tenant to pay the rent they owe, while they keep living there. It doesn&apos;t end
        the tenancy (for that, serve an N4 and then file an L1). No notice is needed first. Vacantless fills the
        official 2026 L9 with the rent owing up to the day you file; you sign it and file it on the{" "}
        <a href="https://tribunalsontario.ca/ltb/tribunals-ontario-portal/" target="_blank" rel="noopener noreferrer" className="underline">
          Tribunals Ontario Portal
        </a>{" "}
        ({formatMoneyCents(L1_FEE_PORTAL_CENTS)}) or on paper ({formatMoneyCents(L1_FEE_PAPER_CENTS)}).
      </p>

      {!active ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          Only for a current tenancy. If the tenant moved out, use an L10.
        </div>
      ) : ledgerProblem ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          {L9_PROBLEM_TEXT[ledgerProblem]}
        </div>
      ) : (
        <form
          action={`/dashboard/tenancies/${tenancyId}/l9/official`}
          method="post"
          target="_blank"
          className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2"
        >
          {owingTodayCents != null && (
            <p className="text-sm text-gray-700 sm:col-span-2">
              Rent owing today from the rent ledger: <strong>{formatMoneyCents(owingTodayCents)}</strong>.
            </p>
          )}
          <div>
            <label className={LABEL_CLS}>Filing date</label>
            <input type="date" name="filing_date" defaultValue={today} max={today} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>How you will file</label>
            <select name="method" defaultValue="portal" className={INPUT_CLS}>
              <option value="portal">Tribunals Ontario Portal ({formatMoneyCents(L1_FEE_PORTAL_CENTS)} fee)</option>
              <option value="paper">Mail, courier or ServiceOntario ({formatMoneyCents(L1_FEE_PAPER_CENTS)} fee)</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Is the tenant still living there?</label>
            <select name="in_possession" defaultValue="yes" className={INPUT_CLS}>
              <option value="yes">Yes</option>
              <option value="no">No, they moved out</option>
            </select>
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
          <div className="flex items-end">
            <button type="submit" className={BTN_PRIMARY}>
              Download official L9 (PDF)
            </button>
          </div>
          <p className="text-xs text-gray-500 sm:col-span-2">
            Check each tenant&apos;s first and last name on the form (two-part last names may split wrong). NSF cheque
            charges and a third tenant aren&apos;t filled in for you: add NSF charges in Part 5 and use the LTB&apos;s
            Schedule of Parties form for more than 2 tenants.
          </p>
        </form>
      )}
    </div>
  );
}
