import {
  addWaitlistEntry,
  removeWaitlistEntry,
  convertWaitlistEntry,
  notifyWaitlist,
} from "./waitlist-actions";
import { preferenceSummary, waitlistStatusLabel } from "@/lib/waitlist";

// Waiting-list operator card (S457) — property-scoped capture + one-tap notify.
// Server component: forms post to server actions; a native <details> hides the
// add form and each entry's actions. Mirrors the violation-section styling and
// the marketing-card locked/upsell pattern. Ungated plans still capture public
// joins, so the locked state shows the waiting count as an upgrade hook.

export type WaitlistEntryView = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  beds_min: number | null;
  max_rent_cents: number | null;
  move_in_by: string | null;
  message: string | null;
  notes: string | null;
  source: string | null;
  status: string | null;
  created_at: string | null;
  last_notified_at: string | null;
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

const STATUS_META: Record<string, { cls: string }> = {
  active: { cls: "bg-amber-100 text-amber-800" },
  converted: { cls: "bg-green-100 text-green-800" },
  removed: { cls: "bg-gray-100 text-gray-600" },
};

function flashMessage(flash: string | undefined): { text: string; ok: boolean } | null {
  if (!flash) return null;
  if (flash.startsWith("notified-")) {
    const n = Number.parseInt(flash.slice("notified-".length), 10);
    return { text: `Notified ${n} ${n === 1 ? "person" : "people"} on the waiting list.`, ok: true };
  }
  switch (flash) {
    case "added":
      return { text: "Added to the waiting list.", ok: true };
    case "removed":
      return { text: "Removed from the waiting list.", ok: true };
    case "converted":
      return { text: "Marked as converted.", ok: true };
    case "nomatch":
      return { text: "No one on the waiting list matches this unit right now.", ok: true };
    case "notavailable":
      return { text: "Mark the unit available before notifying the waiting list.", ok: false };
    case "needcontact":
      return { text: "Add an email or phone so they can be reached.", ok: false };
    case "locked":
      return { text: "Notifying the waiting list is a Growth feature.", ok: false };
    case "forbidden":
      return { text: "You don't have permission to manage the waiting list.", ok: false };
    default:
      return null;
  }
}

function AddFields() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL_CLS}>Name</label>
        <input name="name" className={INPUT_CLS} placeholder="Renter name" />
      </div>
      <div>
        <label className={LABEL_CLS}>Email</label>
        <input name="email" type="email" className={INPUT_CLS} placeholder="name@example.com" />
      </div>
      <div>
        <label className={LABEL_CLS}>Phone</label>
        <input name="phone" className={INPUT_CLS} placeholder="519-555-1212" />
      </div>
      <div>
        <label className={LABEL_CLS}>Wants to move in by (optional)</label>
        <input name="move_in_by" type="date" className={INPUT_CLS} />
      </div>
      <div>
        <label className={LABEL_CLS}>Min bedrooms (optional)</label>
        <input name="beds_min" type="number" min={0} max={20} className={INPUT_CLS} placeholder="e.g. 2" />
      </div>
      <div>
        <label className={LABEL_CLS}>Max rent (optional)</label>
        <input name="max_rent" className={INPUT_CLS} placeholder="e.g. $1,800" />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Notes (optional)</label>
        <input name="notes" className={INPUT_CLS} placeholder="e.g. called about the 2-bed; wants ground floor" />
      </div>
    </div>
  );
}

function contactLine(e: WaitlistEntryView): string {
  const parts: string[] = [];
  if (e.email?.trim()) parts.push(e.email.trim());
  if (e.phone?.trim()) parts.push(e.phone.trim());
  return parts.join(" · ");
}

export function WaitlistCard({
  propertyId,
  entries,
  locked,
  propertyAvailable,
  matchingCount,
  flash,
}: {
  propertyId: string;
  entries: WaitlistEntryView[];
  locked: boolean;
  propertyAvailable: boolean;
  matchingCount: number;
  flash?: string;
}) {
  const active = entries.filter((e) => (e.status ?? "active") === "active");
  const msg = flashMessage(flash);

  return (
    <div id="waitlist" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">Waiting list</h2>
        {active.length > 0 ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            {active.length} waiting
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Renters who asked to be told when this unit opens up. When it&rsquo;s available again,
        notify everyone waiting with one tap.
      </p>

      {msg ? (
        <div
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            msg.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
          }`}
        >
          {msg.text}
        </div>
      ) : null}

      {locked ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-gray-900">
            {active.length > 0
              ? `${active.length} ${active.length === 1 ? "renter is" : "renters are"} waiting for this unit.`
              : "Capture renters who want this unit when it opens."}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Upgrade to <strong>Growth</strong> to add renters yourself and email the waiting list
            the moment the unit is available again.
          </p>
        </div>
      ) : (
        <>
          {/* Notify action — only when the unit is available and someone matches. */}
          {propertyAvailable && matchingCount > 0 ? (
            <form action={notifyWaitlist} className="mt-4">
              <input type="hidden" name="property_id" value={propertyId} />
              <button
                type="submit"
                className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:w-auto"
              >
                Notify {matchingCount} waiting {matchingCount === 1 ? "renter" : "renters"}
              </button>
              <p className="mt-1.5 text-xs text-gray-500">
                Emails everyone matching this unit who hasn&rsquo;t been notified about it yet.
              </p>
            </form>
          ) : !propertyAvailable && active.length > 0 ? (
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Mark this unit <strong>Available</strong> to notify the {active.length} waiting.
            </p>
          ) : null}

          {/* Entries */}
          {active.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              No one waiting yet. Renters can join from the listing page when it&rsquo;s not
              available, or add someone below.
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
              {entries.map((e) => {
                const status = (e.status ?? "active").trim();
                const meta = STATUS_META[status] ?? STATUS_META.active;
                const prefs = preferenceSummary({
                  beds_min: e.beds_min,
                  max_rent_cents: e.max_rent_cents,
                  move_in_by: e.move_in_by,
                });
                return (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {e.name?.trim() || "Interested renter"}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                            {waitlistStatusLabel(status)}
                          </span>
                          {e.source === "public" ? (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                              from listing
                            </span>
                          ) : null}
                          {e.last_notified_at ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                              notified
                            </span>
                          ) : null}
                        </div>
                        {contactLine(e) ? (
                          <div className="mt-0.5 truncate text-sm text-gray-700">{contactLine(e)}</div>
                        ) : null}
                        {prefs ? <div className="mt-0.5 text-xs text-gray-500">{prefs}</div> : null}
                        {e.message?.trim() ? (
                          <div className="mt-0.5 truncate text-xs text-gray-500">
                            &ldquo;{e.message.trim()}&rdquo;
                          </div>
                        ) : null}
                        {e.notes?.trim() ? (
                          <div className="mt-0.5 truncate text-xs text-gray-400">{e.notes.trim()}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        {status === "active" ? (
                          <form action={convertWaitlistEntry}>
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="property_id" value={propertyId} />
                            <button type="submit" className="text-sm font-medium text-brand hover:underline">
                              Converted
                            </button>
                          </form>
                        ) : null}
                        <form action={removeWaitlistEntry}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="property_id" value={propertyId} />
                          <button type="submit" className="text-sm font-medium text-gray-400 hover:text-red-600">
                            Remove
                          </button>
                        </form>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Add someone */}
          <details className="group mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
              + Add someone to the waiting list
            </summary>
            <form action={addWaitlistEntry} className="mt-4">
              <input type="hidden" name="property_id" value={propertyId} />
              <AddFields />
              <div className="mt-3">
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Add to waiting list
                </button>
              </div>
            </form>
          </details>
        </>
      )}
    </div>
  );
}
