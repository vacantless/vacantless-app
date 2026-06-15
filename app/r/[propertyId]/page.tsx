import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { submitLead } from "./actions";
import { generateSlots, type Availability } from "@/lib/booking";
import { accessibleBrand } from "@/lib/brand-theme";

export const dynamic = "force-dynamic";

type Listing = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  parking: string | null;
  description: string | null;
  status: string;
  org_name: string;
  brand_color: string;
  logo_url: string | null;
};

export default async function PublicListingPage({
  params,
  searchParams,
}: {
  params: { propertyId: string };
  searchParams: { submitted?: string; error?: string };
}) {
  const supabase = createClient();
  const [{ data }, { data: avData }] = await Promise.all([
    supabase.rpc("get_public_listing", { p_property_id: params.propertyId }),
    supabase.rpc("get_public_availability", { p_property_id: params.propertyId }),
  ]);

  if (!data) notFound();
  const l = data as Listing;
  // Guardrail: keep white-on-brand (header, button) and brand-on-white (price)
  // legible even when the tenant picked a pale color.
  const brand = accessibleBrand(l.brand_color || "#4f46e5");

  const av = avData as Availability | null;
  const days = av ? generateSlots(av) : [];

  const specs = [
    l.beds != null ? `${l.beds} bed${l.beds === 1 ? "" : "s"}` : null,
    l.baths != null ? `${l.baths} bath` : null,
    l.parking ? `Parking: ${l.parking}` : null,
  ].filter(Boolean);

  const booked = searchParams.submitted === "booked";

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand }}
    >
      <header className="text-white" style={{ backgroundColor: brand }}>
        <div className="mx-auto max-w-2xl px-6 py-5">
          {l.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.logo_url} alt={l.org_name} className="h-8" />
          ) : (
            <p className="text-lg font-bold">{l.org_name}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900">{l.address}</h1>
        <p className="mt-1 text-lg font-semibold" style={{ color: brand }}>
          {l.rent_cents
            ? `$${(l.rent_cents / 100).toLocaleString()}/mo`
            : "Contact for pricing"}
        </p>
        {specs.length > 0 && (
          <p className="mt-1 text-sm text-gray-600">{specs.join(" · ")}</p>
        )}
        {l.description && (
          <p className="mt-4 whitespace-pre-wrap text-gray-700">
            {l.description}
          </p>
        )}

        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {searchParams.submitted ? (
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">
                {booked ? "Your showing is booked!" : "Thanks — we got your inquiry!"}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {booked
                  ? `We've emailed you the details. ${l.org_name} will see you then.`
                  : `The team at ${l.org_name} will be in touch shortly to set up a viewing.`}
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-gray-900">
                {days.length > 0 ? "Book a showing" : "Request a showing"}
              </h2>
              <p className="mb-4 mt-1 text-sm text-gray-500">
                {days.length > 0
                  ? "Pick a time that works for you, or just send your details and we'll reach out."
                  : "Tell us a bit about you and we'll reach out to book a time."}
              </p>
              {searchParams.error && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Sorry, something went wrong. Please try again.
                </p>
              )}
              <form action={submitLead} className="space-y-4">
                <input type="hidden" name="property_id" value={l.id} />

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Full name
                    </label>
                    <input
                      name="name"
                      required
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Email
                      </label>
                      <input
                        name="email"
                        type="email"
                        required
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Phone
                      </label>
                      <input
                        name="phone"
                        type="tel"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Desired move-in date
                    </label>
                    <input
                      name="move_in"
                      type="date"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Anything else?
                    </label>
                    <textarea
                      name="notes"
                      rows={3}
                      placeholder="Number of occupants, pets, questions…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {days.length > 0 && (
                  <fieldset className="rounded-lg border border-gray-200 p-4">
                    <legend className="px-1 text-sm font-medium text-gray-700">
                      Choose a showing time{" "}
                      <span className="font-normal text-gray-400">(optional)</span>
                    </legend>
                    <p className="mb-3 mt-1 text-xs text-gray-400">
                      Times shown in {av?.timezone?.replace(/_/g, " ")}.
                    </p>
                    <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                      {days.map((day) => (
                        <div key={day.dayKey}>
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                            {day.dayLabel}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {day.slots.map((s) => (
                              <label key={s.iso} className="cursor-pointer">
                                <input
                                  type="radio"
                                  name="slot"
                                  value={s.iso}
                                  className="peer sr-only"
                                />
                                <span className="block rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 peer-checked:border-gray-900 peer-checked:bg-gray-900 peer-checked:text-white">
                                  {s.label}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                )}

                <button
                  type="submit"
                  className="w-full rounded-lg px-4 py-2.5 font-medium text-white"
                  style={{ backgroundColor: brand }}
                >
                  {days.length > 0 ? "Confirm" : "Request a showing"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Powered by Vacantless
        </p>
      </main>
    </div>
  );
}
