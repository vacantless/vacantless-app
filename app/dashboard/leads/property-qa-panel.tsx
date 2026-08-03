import type { PropertyQaEntry } from "@/lib/property-qa";
import {
  addLeadPropertyQa,
  deleteLeadPropertyQa,
  promoteLeadPropertyQa,
  updateLeadPropertyQa,
} from "./actions";

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

const FLASH: Record<string, { message: string; error?: boolean }> = {
  saved: { message: "Answer saved." },
  deleted: { message: "Answer deleted." },
  promoted: { message: "Answer promoted to all listings." },
  disabled: { message: "AI reply drafts are off for this company.", error: true },
  forbidden: { message: "You do not have permission to manage these answers.", error: true },
  invalid: { message: "Add both a question and an answer.", error: true },
  missing: { message: "That answer could not be found.", error: true },
  "missing-property": { message: "This inquiry is not attached to a rental.", error: true },
  error: { message: "The answer could not be saved.", error: true },
};

function ScopeBadge({ entry }: { entry: PropertyQaEntry }) {
  const label = entry.propertyId ? "This rental" : "All listings";
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {label}
    </span>
  );
}

function EntryList({
  leadId,
  propertyId,
  entries,
  title,
}: {
  leadId: string;
  propertyId: string;
  entries: PropertyQaEntry[];
  title: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
        No {title.toLowerCase()} yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h4>
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {entries.map((entry) => (
          <li key={entry.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">
                    {entry.questionText}
                  </p>
                  <ScopeBadge entry={entry} />
                  {entry.source === "auto" && (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                      Learned
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {entry.answerText}
                </p>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
                Edit answer
              </summary>
              <form action={updateLeadPropertyQa} className="mt-3 grid gap-3">
                <input type="hidden" name="lead_id" value={leadId} />
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="qa_id" value={entry.id} />
                <label>
                  <span className={labelCls}>Question</span>
                  <input
                    name="question_text"
                    defaultValue={entry.questionText}
                    className={inputCls}
                  />
                </label>
                <label>
                  <span className={labelCls}>Answer</span>
                  <textarea
                    name="answer_text"
                    rows={3}
                    defaultValue={entry.answerText}
                    className={inputCls}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
                    Save answer
                  </button>
                </div>
              </form>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {entry.propertyId && (
                  <form action={promoteLeadPropertyQa}>
                    <input type="hidden" name="lead_id" value={leadId} />
                    <input type="hidden" name="property_id" value={propertyId} />
                    <input type="hidden" name="qa_id" value={entry.id} />
                    <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Promote to all my listings
                    </button>
                  </form>
                )}
                <form action={deleteLeadPropertyQa}>
                  <input type="hidden" name="lead_id" value={leadId} />
                  <input type="hidden" name="property_id" value={propertyId} />
                  <input type="hidden" name="qa_id" value={entry.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PropertyQaPanel({
  leadId,
  propertyId,
  entries,
  flash,
}: {
  leadId: string;
  propertyId: string;
  entries: PropertyQaEntry[];
  flash?: string | null;
}) {
  const propertyEntries = entries.filter((entry) => entry.propertyId != null);
  const orgEntries = entries.filter((entry) => entry.propertyId == null);
  const flashMeta = flash ? FLASH[flash] : null;

  return (
    <details
      id="property-qa"
      className="mt-4 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
        Answers the AI can use
        <span className="ml-2 text-xs font-medium text-gray-500">
          {entries.length === 0 ? "None saved" : `${entries.length} saved`}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        {flashMeta && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              flashMeta.error
                ? "border border-red-200 bg-red-50 text-red-700"
                : "border border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {flashMeta.message}
          </p>
        )}

        <p className="text-sm leading-relaxed text-gray-600">
          Saved answers are used only when the AI draft helper is enabled. This
          rental&apos;s answers are checked before common answers for all listings.
        </p>

        <form
          action={addLeadPropertyQa}
          className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="property_id" value={propertyId} />
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <label>
              <span className={labelCls}>Question</span>
              <input
                name="question_text"
                placeholder="e.g. Is parking included?"
                className={inputCls}
              />
            </label>
            <label>
              <span className={labelCls}>Use for</span>
              <select name="scope" defaultValue="property" className={inputCls}>
                <option value="property">This rental</option>
                <option value="org">All listings</option>
              </select>
            </label>
          </div>
          <label>
            <span className={labelCls}>Answer</span>
            <textarea
              name="answer_text"
              rows={3}
              placeholder="Write the exact answer the draft may reuse."
              className={inputCls}
            />
          </label>
          <div>
            <button className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
              Add answer
            </button>
          </div>
        </form>

        <EntryList
          leadId={leadId}
          propertyId={propertyId}
          entries={propertyEntries}
          title="This rental"
        />
        <EntryList
          leadId={leadId}
          propertyId={propertyId}
          entries={orgEntries}
          title="All listings"
        />
      </div>
    </details>
  );
}
