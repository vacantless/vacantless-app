import { earliestL1FilingDate, L1_FEE_PAPER_CENTS, L1_FEE_PORTAL_CENTS, L1_PROBLEM_TEXT, type L1Problem } from "@/lib/l1";
import { formatMoneyCents } from "@/lib/payments";
import { formatLongDate } from "@/lib/n1-render";

// S748g: "Prepare L1" for a served N4 the tenant didn't pay. The form posts to
// /dashboard/tenancies/[id]/l1/official, which counts the rent owing to the filing
// date and returns the official 2026/09 L1 for the landlord to sign and file.

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";

export type L1N4View = { id: string; status: string; termination_date: string | null; total_owing_cents: number | null };

export function TenancyL1Section({
  tenancyId,
  servedN4s,
  landlordName,
  landlordPhone,
  depositCents,
  today,
  msg,
}: {
  tenancyId: string;
  servedN4s: L1N4View[];
  landlordName: string;
  landlordPhone: string | null;
  depositCents: number | null;
  today: string;
  msg?: string;
}) {
  const problem = msg && msg in L1_PROBLEM_TEXT ? L1_PROBLEM_TEXT[msg as L1Problem] : null;
  const n4 = servedN4s.find((n) => n.termination_date) ?? null;
  const earliest = n4?.termination_date ? earliestL1FilingDate(n4.termination_date) : null;
  const filingDefault = earliest && earliest > today ? earliest : today;

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form L1: apply to evict for unpaid rent</h4>
      {problem && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{problem}</div>
      )}
      <p className="text-sm text-gray-600">
        If the tenant didn&apos;t pay by the N4&apos;s date, Vacantless fills the official 2026 L1 with the rent
        owing up to the day you file. You sign it and file it on the{" "}
        <a href="https://tribunalsontario.ca/ltb/tribunals-ontario-portal/" target="_blank" rel="noopener noreferrer" className="underline">
          Tribunals Ontario Portal
        </a>{" "}
        ({formatMoneyCents(L1_FEE_PORTAL_CENTS)}) or on paper ({formatMoneyCents(L1_FEE_PAPER_CENTS)}), with a copy of
        the N4 and a Certificate of Service.
      </p>

      {!n4 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          Available after you prepare an N4 and record that you served it.
        </div>
      ) : (
        <form
          action={`/dashboard/tenancies/${tenancyId}/l1/official`}
          method="post"
          target="_blank"
          className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2"
        >
          <input type="hidden" name="notice_id" value={n4.id} />
          <p className="text-sm text-gray-700 sm:col-span-2">
            Based on the N4 that ended {formatLongDate(n4.termination_date)}. Earliest filing day:{" "}
            <strong>{formatLongDate(earliest)}</strong>.
          </p>
          <div>
            <label className={LABEL_CLS}>Filing date</label>
            <input type="date" name="filing_date" defaultValue={filingDefault} className={INPUT_CLS} />
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
              Download official L1 (PDF)
            </button>
          </div>
          <p className="text-xs text-gray-500 sm:col-span-2">
            Check each tenant&apos;s first and last name on the form (two-part last names may split wrong). NSF cheque charges and a third tenant aren&apos;t filled in for you: add NSF charges on page 6 and use the
            LTB&apos;s Schedule of Parties form for more than 2 tenants.
          </p>
        </form>
      )}
    </div>
  );
}
