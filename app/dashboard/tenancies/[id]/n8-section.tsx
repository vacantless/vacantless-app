import { prepareN8, recordN8Service, voidN8 } from "../n8-actions";
import { countableLatePeriods, earliestN8TerminationDate, N8_MAX_DETAIL_CHARS, N8_MIN_LATE_COUNT, N8_PROBLEM_TEXT, n8DetailsText, type N8LatePeriod, type N8Problem } from "@/lib/n8";
import { formatLongDate } from "@/lib/n1-render";

// S749: "Prepare N8" (persistent late rent) on the tenancy page. Vacantless reads
// the rent ledger for payments made more than 7 days late in the past 6 months,
// writes the details for the landlord to check, checks the dates, freezes the
// answers and fills the official 2026/09 form for them to sign and serve.

export type N8NoticeView = { id: string; status: string; termination_date: string | null; created_at: string };

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";
const BTN_SECONDARY =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", served: "Served", filed: "Filed", void: "Void" };

const MSG: Record<string, { ok: boolean; text: string }> = {
  prepared: { ok: true, text: "N8 prepared. Download it, sign it, serve it, then record that you served it." },
  served: { ok: true, text: "Service recorded. You can apply with an L2 right away." },
  voided: { ok: true, text: "Notice voided." },
  notready: { ok: false, text: "An N8 needs an active tenancy with a rent amount." },
  notdraft: { ok: false, text: "That notice was already served." },
  badmethod: { ok: false, text: "Pick how you will serve the notice." },
  forbidden: { ok: false, text: "You don't have permission to prepare notices." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

export function TenancyN8Section({
  tenancyId,
  active,
  rentCents,
  endDate,
  landlordName,
  latePeriods,
  notices,
  today,
  msg,
}: {
  tenancyId: string;
  active: boolean;
  rentCents: number | null;
  endDate: string | null;
  landlordName: string;
  /** Late periods in the 6 months before today, rent due on the 1st. */
  latePeriods: N8LatePeriod[];
  notices: N8NoticeView[];
  today: string;
  msg?: string;
}) {
  const fixedTermEndISO = endDate && endDate >= today ? endDate : null;
  const earliest = earliestN8TerminationDate({ serviceDateISO: today, method: "hand", dueDay: 1, fixedTermEndISO });
  const banner = msg ? MSG[msg] ?? (N8_PROBLEM_TEXT[msg as N8Problem] ? { ok: false, text: N8_PROBLEM_TEXT[msg as N8Problem] } : null) : null;
  const open = notices.filter((n) => n.status !== "void");
  const counted = countableLatePeriods(latePeriods).length;
  const enough = counted >= N8_MIN_LATE_COUNT;

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form N8: rent is often late</h4>
      {banner && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            banner.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {banner.text}
        </div>
      )}
      <p className="text-sm text-gray-600">
        Since September 21, 2026, rent paid more than 7 days late at least 3 times in 6 months counts as persistently
        late. Vacantless checks your rent ledger, writes the details and fills the official 2026 N8. You sign it and{" "}
        <strong>serve it yourself</strong>, at least 60 days before the end date.
      </p>

      {!active || !rentCents ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          An N8 is available for an active tenancy with a rent amount.
        </div>
      ) : !enough ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          The rent ledger shows {counted} payment{counted === 1 ? "" : "s"} made more than 7 days late in the past 6
          months, counting rent due on or after September 21, 2026, when this rule started (an N8 needs at least 3).
          Record each payment with the date it arrived under Rent.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Earliest end date</div>
            <div className="font-medium text-gray-900">{formatLongDate(earliest)}</div>
            <div className="text-xs text-gray-500">served by hand today, rent due on the 1st</div>
          </div>
          {fixedTermEndISO && (
            <p className="mb-3 text-xs text-amber-700">
              The lease is in a fixed term until {formatLongDate(fixedTermEndISO)}. The end date can&apos;t be before that.
            </p>
          )}
          <form action={prepareN8} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="tenancy_id" value={tenancyId} />
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>Details for the notice (check and edit)</label>
              <textarea
                name="details"
                rows={8}
                maxLength={N8_MAX_DETAIL_CHARS}
                defaultValue={n8DetailsText(rentCents, 1, latePeriods)}
                className={INPUT_CLS}
              />
              <p className="mt-1 text-xs text-gray-500">
                Don&apos;t count a payment that was only late because you applied it to older arrears.
              </p>
            </div>
            <div>
              <label className={LABEL_CLS}>Landlord&apos;s name on the notice</label>
              <input name="landlord_name" defaultValue={landlordName} className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Date you will serve it</label>
              <input type="date" name="service_date" defaultValue={today} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>How you will serve it</label>
              <select name="method" defaultValue="hand" className={INPUT_CLS}>
                <option value="hand">By hand, mailbox or under the door</option>
                <option value="mail">Mail or Xpresspost (adds 5 days)</option>
                <option value="courier">Courier (adds 1 business day)</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Day of the month rent is due</label>
              <input name="due_day" type="number" min={1} max={31} defaultValue={1} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>End date (leave blank for the earliest)</label>
              <input type="date" name="termination_date" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Your first name (signature block)</label>
              <input name="signer_first" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Your last name</label>
              <input name="signer_last" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Your phone</label>
              <input name="signer_phone" className={INPUT_CLS} />
            </div>
            <div className="flex items-end">
              <button type="submit" className={BTN_PRIMARY}>
                Prepare N8
              </button>
            </div>
          </form>
        </div>
      )}

      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {STATUS_LABEL[n.status] ?? n.status}
              </span>
              <span className="text-gray-900">ends {formatLongDate(n.termination_date) ?? ""}</span>
              <a
                href={`/dashboard/tenancies/${tenancyId}/n8/official?notice=${n.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_SECONDARY}
              >
                Download official N8 (PDF)
              </a>
              {n.status === "draft" && (
                <form action={recordN8Service}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="notice_id" value={n.id} />
                  <button type="submit" className={BTN_SECONDARY}>
                    Record service
                  </button>
                </form>
              )}
              <form action={voidN8} className="ml-auto">
                <input type="hidden" name="tenancy_id" value={tenancyId} />
                <input type="hidden" name="notice_id" value={n.id} />
                <button type="submit" className="text-xs text-gray-400 hover:text-red-600">
                  Void
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
