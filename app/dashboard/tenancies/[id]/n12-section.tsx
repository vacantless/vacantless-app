import { prepareN12, recordN12Service, voidN12 } from "../n12-actions";
import { earliestN12TerminationDate, n12NoCompensationDate, N12_PROBLEM_TEXT, type N12Problem } from "@/lib/n12";
import { formatMoneyCents } from "@/lib/payments";
import { formatLongDate } from "@/lib/n1-render";

// S748g: "Prepare N12" on the tenancy page. The landlord answers who is moving in
// and when; Vacantless checks the dates and the compensation rule, freezes the
// answers, and fills the official 2026/10 form for them to sign and serve.

export type N12NoticeView = {
  id: string;
  status: string;
  termination_date: string | null;
  total_owing_cents: number | null;
  compensation_required: boolean;
  created_at: string;
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";
const BTN_SECONDARY =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", served: "Served", filed: "Filed", void: "Void" };

const MSG: Record<string, { ok: boolean; text: string }> = {
  prepared: { ok: true, text: "N12 prepared. Download it, sign it, serve it, then record that you served it." },
  served: { ok: true, text: "Service recorded." },
  voided: { ok: true, text: "Notice voided." },
  notready: { ok: false, text: "An N12 needs an active tenancy." },
  notdraft: { ok: false, text: "That notice was already served." },
  badmethod: { ok: false, text: "Pick how you will serve the notice." },
  forbidden: { ok: false, text: "You don't have permission to prepare notices." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

const RELATIONSHIPS: { value: string; r1: string; r2: string }[] = [
  { value: "self", r1: "Me", r2: "The purchaser" },
  { value: "spouse", r1: "My spouse", r2: "The purchaser's spouse" },
  { value: "child", r1: "My child", r2: "The purchaser's child" },
  { value: "parent", r1: "My parent", r2: "The purchaser's parent" },
  { value: "spouse_child", r1: "My spouse's child", r2: "The purchaser's spouse's child" },
  { value: "spouse_parent", r1: "My spouse's parent", r2: "The purchaser's spouse's parent" },
];

export function TenancyN12Section({
  tenancyId,
  active,
  rentCents,
  endDate,
  landlordName,
  notices,
  today,
  msg,
}: {
  tenancyId: string;
  active: boolean;
  rentCents: number | null;
  endDate: string | null;
  landlordName: string;
  notices: N12NoticeView[];
  today: string;
  msg?: string;
}) {
  const fixedTermEndISO = endDate && endDate >= today ? endDate : null;
  const dateInput = { serviceDateISO: today, method: "hand" as const, dueDay: 1, fixedTermEndISO };
  const earliest = earliestN12TerminationDate(dateInput);
  const noComp = n12NoCompensationDate(dateInput);
  const banner = msg ? MSG[msg] ?? (N12_PROBLEM_TEXT[msg as N12Problem] ? { ok: false, text: N12_PROBLEM_TEXT[msg as N12Problem] } : null) : null;
  const open = notices.filter((n) => n.status !== "void");

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form N12: you, a buyer or family needs the unit</h4>
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
        Vacantless fills the official 2026 N12 and checks the dates. You sign it and{" "}
        <strong>serve it yourself</strong>. The person moving in will also need to sign a declaration
        that they need the unit in good faith if you apply to the LTB.
      </p>

      {!active ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          An N12 is available for an active tenancy.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Earliest end date</div>
              <div className="font-medium text-gray-900">{formatLongDate(earliest)}</div>
              <div className="text-xs text-gray-500">served by hand today, rent due on the 1st</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">No compensation from</div>
              <div className="font-medium text-gray-900">{formatLongDate(noComp)}</div>
              <div className="text-xs text-gray-500">
                own use only (Reason 1). Earlier, or for a buyer, you owe one month&apos;s rent
                {rentCents != null ? ` (${formatMoneyCents(rentCents)})` : ""} by the end date.
              </div>
            </div>
          </div>
          {fixedTermEndISO && (
            <p className="mb-3 text-xs text-amber-700">
              The lease is in a fixed term until {formatLongDate(fixedTermEndISO)}. The end date can&apos;t be before that.
            </p>
          )}

          <form action={prepareN12} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="tenancy_id" value={tenancyId} />
            <div className="sm:col-span-2">
              <span className={LABEL_CLS}>Reason</span>
              <label className="mr-4 text-sm">
                <input type="radio" name="reason" value="1" defaultChecked /> Reason 1: me or my family moving in
              </label>
              <label className="text-sm">
                <input type="radio" name="reason" value="2" /> Reason 2: a buyer or their family moving in
              </label>
            </div>
            <div>
              <label className={LABEL_CLS}>Landlord&apos;s name on the notice</label>
              <input name="landlord_name" defaultValue={landlordName} className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Is the landlord a person (not a company)?</label>
              <select name="landlord_individual" defaultValue="yes" className={INPUT_CLS}>
                <option value="yes">Yes, a person</option>
                <option value="no">No, a company</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">A company can&apos;t use Reason 1.</p>
            </div>
            <div>
              <label className={LABEL_CLS}>Name of the person moving in</label>
              <input name="person_name" className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Who they are (to you, or to the buyer)</label>
              <select name="relationship" defaultValue="self" className={INPUT_CLS}>
                {RELATIONSHIPS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.r1} / {r.r2}
                  </option>
                ))}
              </select>
              <label className="mt-1 block text-xs text-gray-600">
                <input type="checkbox" name="care" value="yes" /> They are moving in to give care to this person
              </label>
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
                Prepare N12
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
              <span className="text-xs text-gray-500">
                {!n.compensation_required
                  ? "no compensation owed"
                  : n.total_owing_cents != null
                    ? `compensation ${formatMoneyCents(n.total_owing_cents)} due by the end date`
                    : "one month's rent compensation due by the end date"}
              </span>
              <a
                href={`/dashboard/tenancies/${tenancyId}/n12/official?notice=${n.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_SECONDARY}
              >
                Download official N12 (PDF)
              </a>
              {n.status === "draft" && (
                <form action={recordN12Service}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="notice_id" value={n.id} />
                  <button type="submit" className={BTN_SECONDARY}>
                    Record service
                  </button>
                </form>
              )}
              <form action={voidN12} className="ml-auto">
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
