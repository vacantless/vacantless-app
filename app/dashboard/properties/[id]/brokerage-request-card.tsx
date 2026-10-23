import type { BrokerageRoute } from "@/lib/brokerage-request";
import { requestBrokerageListing } from "./brokerage-actions";

// S735: Realtor.ca through a partner agent. Not a site tile (S710 decision):
// a request card under the site list that a person answers. Copy from the
// S585 routes the broker approved in principle.
export type BrokerageRequestCardData = {
  route: BrokerageRoute;
  /** The open request for this rental, if the landlord already asked. */
  existing: { createdAt: string; contactPhone: string | null; contactEmail: string | null } | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /** ?brk= result of the last submit. */
  notice: "sent" | "contact" | "email" | "error" | null;
};

export function BrokerageRequestCard({
  propertyId,
  data,
}: {
  propertyId: string;
  data: BrokerageRequestCardData;
}) {
  const { route, existing, notice } = data;
  const reach = existing
    ? [existing.contactPhone, existing.contactEmail].filter(Boolean).join(" or ")
    : "";
  return (
    <section
      id="realtor-ca-request"
      className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-gray-900">{route.title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{route.body}</p>
      {existing ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[12.5px] text-green-900">
          You asked on {formatDay(existing.createdAt)}. A person will reach you
          {reach ? ` at ${reach}` : ""} within one business day.
        </div>
      ) : (
        <details className="mt-3" open={notice != null && notice !== "sent"}>
          <summary className="inline-flex cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50">
            {route.action} →
          </summary>
          {notice === "contact" && (
            <p className="mt-2 text-[12px] text-red-700">Give a phone number or an email so we can reach you.</p>
          )}
          {notice === "email" && (
            <p className="mt-2 text-[12px] text-red-700">That email does not look right.</p>
          )}
          {notice === "error" && (
            <p className="mt-2 text-[12px] text-red-700">Something went wrong. Please try again.</p>
          )}
          <form action={requestBrokerageListing} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="property_id" value={propertyId} />
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-gray-700">Your name</span>
              <input
                name="contact_name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-gray-700">Best phone</span>
              <input
                name="contact_phone"
                type="tel"
                inputMode="tel"
                defaultValue={data.contactPhone ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-gray-700">Email</span>
              <input
                name="contact_email"
                type="email"
                inputMode="email"
                defaultValue={data.contactEmail ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[12px] font-medium text-gray-700">
                Anything we should know <span className="text-gray-400">optional</span>
              </span>
              <textarea
                name="note"
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="When to call, or what you want to ask."
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="inline-flex rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
              >
                Send my request
              </button>
            </div>
          </form>
        </details>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">{route.finePrint}</p>
    </section>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an earlier day";
  return d.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
}
