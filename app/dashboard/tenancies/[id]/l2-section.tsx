import { L1_FEE_PAPER_CENTS, L1_FEE_PORTAL_CENTS } from "@/lib/l1";
import { latestL2FilingDate, L2_PROBLEM_TEXT, type L2Problem } from "@/lib/l2";
import { formatMoneyCents } from "@/lib/payments";
import { formatLongDate } from "@/lib/n1-render";

// S749: "Prepare L2" for a served N5, N8, N12 or N13 (S751). Each form posts to
// /dashboard/tenancies/[id]/l2/official, which checks the filing window and
// returns the official 2026/09 L2 for the landlord to sign and file.

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";

export type L2NoticeView = {
  id: string;
  type: "N5" | "N6" | "N8" | "N12" | "N13";
  status: string;
  termination_date: string | null;
  earliest_filing: string | null;
  compensation_required?: boolean;
  reason?: 1 | 2 | 3;
  /** N13: permits answer on the notice, and whether the work was ordered under a law. */
  permits?: string | null;
  ordered?: boolean;
  /** S750: the landlord as named on the notice (person or company). */
  landlord?: { company: string; first: string; last: string };
};

const NOTICE_LABEL: Record<L2NoticeView["type"], string> = {
  N5: "N5 (interference, damage or overcrowding)",
  N8: "N8 (end of term, for example persistent late rent)",
  N6: "N6 (illegal act, or false income in rent-geared-to-income housing)",
  N12: "N12 (landlord, purchaser or family moving in)",
  N13: "N13 (demolish, renovate or convert)",
};

export function TenancyL2Section({
  tenancyId,
  servedNotices,
  landlordName,
  landlordPhone,
  depositCents,
  today,
  msg,
}: {
  tenancyId: string;
  servedNotices: L2NoticeView[];
  landlordName: string;
  landlordPhone: string | null;
  depositCents: number | null;
  today: string;
  msg?: string;
}) {
  const problem = msg && msg in L2_PROBLEM_TEXT ? L2_PROBLEM_TEXT[msg as L2Problem] : null;
  const usable = servedNotices.filter((n) => n.termination_date);

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form L2: apply to end the tenancy after a notice you served</h4>
      {problem && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{problem}</div>
      )}
      <p className="text-sm text-gray-600">
        If the tenant hasn&apos;t moved out, Vacantless fills the official 2026 L2 from the notice you served. You sign it
        and file it on the{" "}
        <a href="https://tribunalsontario.ca/ltb/tribunals-ontario-portal/" target="_blank" rel="noopener noreferrer" className="underline">
          Tribunals Ontario Portal
        </a>{" "}
        ({formatMoneyCents(L1_FEE_PORTAL_CENTS)}) or on paper ({formatMoneyCents(L1_FEE_PAPER_CENTS)}), with a copy of
        the notice and a Certificate of Service. File no later than 30 days after the notice&apos;s termination date.
      </p>

      {usable.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          Available after you prepare an N5, N6, N8, N12 or N13 and record that you served it.
        </div>
      ) : (
        usable.map((n) => {
          const latest = latestL2FilingDate(n.termination_date as string);
          const earliest = n.earliest_filing ?? today;
          const filingDefault = earliest > today ? earliest : today;
          return (
            <form
              key={n.id}
              action={`/dashboard/tenancies/${tenancyId}/l2/official`}
              method="post"
              target="_blank"
              className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2"
            >
              <input type="hidden" name="notice_id" value={n.id} />
              <p className="text-sm text-gray-700 sm:col-span-2">
                Based on your {NOTICE_LABEL[n.type]} that ends {formatLongDate(n.termination_date)}. You can file from{" "}
                <strong>{formatLongDate(earliest)}</strong> to <strong>{formatLongDate(latest)}</strong>.
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
                <label className={LABEL_CLS}>Ask for rent for each day they stay past the termination date?</label>
                <select name="daily_comp" defaultValue="yes" className={INPUT_CLS}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              {n.type === "N12" && (
                <>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLS}>The one month&apos;s compensation (Schedule B)</label>
                    <select name="compensation" defaultValue={n.reason !== 2 && !n.compensation_required ? "not_required" : ""} required className={INPUT_CLS}>
                      <option value="" disabled>
                        Choose one
                      </option>
                      <option value="gave">I paid it on or before the termination date</option>
                      <option value="offered">I offered another unit and the tenant accepted it</option>
                      <option value="will_give">I will pay it by the termination date</option>
                      {n.reason !== 2 && !n.compensation_required && (
                        <option value="not_required">Not required (120 days or more of notice)</option>
                      )}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLS}>
                      Did you give any other N12 or N13 in the past 2 years outside Vacantless (any unit)?
                    </label>
                    <select name="prior_outside" defaultValue="no" className={INPUT_CLS}>
                      <option value="no">No</option>
                      <option value="yes">Yes, I&apos;ll add them to Schedule B myself</option>
                    </select>
                  </div>
                </>
              )}

              {n.type === "N13" && (
                <>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLS}>Have you got the building permits? (Schedule A)</label>
                    <select
                      name="permits_obtained"
                      defaultValue={n.permits === "obtained" ? "yes" : n.permits === "none_needed" ? "" : "no"}
                      className={INPUT_CLS}
                    >
                      <option value="yes">Yes (give copies to the tenant and the LTB before the hearing)</option>
                      <option value="no">Not yet (get them, or show every reasonable step, by the hearing)</option>
                      <option value="">No permits needed: leave it for me to answer</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLS}>The compensation (Schedule A)</label>
                    <select name="compensation" defaultValue={n.ordered ? "ordered" : ""} required className={INPUT_CLS}>
                      <option value="" disabled>
                        Choose one
                      </option>
                      <option value="gave">I paid it on or before the termination date</option>
                      <option value="offered">I offered another unit and the tenant accepted it</option>
                      <option value="will_give">I will pay it by the termination date</option>
                      {n.ordered && <option value="ordered">Not owed: the work was ordered under a by-law or another authority</option>}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLS}>
                      Did you give any other N12 or N13 in the past 2 years outside Vacantless (any unit)?
                    </label>
                    <select name="prior_outside" defaultValue="no" className={INPUT_CLS}>
                      <option value="no">No</option>
                      <option value="yes">Yes, I&apos;ll add them to Schedule A myself</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className={LABEL_CLS}>Company name (if the landlord is a company)</label>
                <input name="landlord_company" defaultValue={n.landlord ? n.landlord.company : landlordName} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Landlord first name</label>
                <input name="landlord_first" defaultValue={n.landlord?.first ?? ""} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Landlord last name</label>
                <input name="landlord_last" defaultValue={n.landlord?.last ?? ""} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Email</label>
                <input name="landlord_email" type="email" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Phone</label>
                <input name="landlord_phone" defaultValue={landlordPhone ?? ""} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>LTB can contact you by</label>
                <select name="by_email" defaultValue="yes" className={INPUT_CLS}>
                  <option value="yes">Email</option>
                  <option value="no">Mail</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL_CLS}>Your mailing address (street, unit, city, province, postal code)</label>
                <input name="landlord_address" placeholder="e.g. 100 King St W, Unit 5, Toronto, ON M5X 1A9" className={INPUT_CLS} />
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
              <div className="flex items-end sm:col-span-2">
                <button type="submit" className={BTN_PRIMARY}>
                  Download official L2 (PDF)
                </button>
              </div>
              <p className="text-xs text-gray-500 sm:col-span-2">
                Check each tenant&apos;s first and last name on the form. Other money claims (NSF, utilities, damage) and a
                third tenant aren&apos;t filled in for you: add those on the form, and use the LTB&apos;s Schedule of Parties
                for more than 2 tenants.
                {n.type === "N12" &&
                  " For an N12, also file a declaration signed by the person moving in (the LTB's Declaration form); the LTB won't accept the L2 without it."}
              </p>
            </form>
          );
        })
      )}
    </div>
  );
}
