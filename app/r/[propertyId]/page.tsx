import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { submitLead, rebookSavedLead } from "./actions";
import { PhotoGallery } from "./photo-gallery";
import { generateSlots, type Availability } from "@/lib/booking";
import { affordabilityHintIncomeCents } from "@/lib/screening";
import { accessibleBrand, brandGradientCss } from "@/lib/brand-theme";
import { Icons } from "@/components/icons";
import {
  buildSpecLine,
  buildAmenityChips,
  formatAvailability,
  utilitiesSummary,
} from "@/lib/property-features";
import { virtualTourFor } from "@/lib/virtual-tour";

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
  available_date: string | null;
  sqft: number | null;
  floor: string | null;
  laundry: string | null;
  air_conditioning: boolean;
  balcony: boolean;
  furnished: boolean;
  pet_friendly: boolean;
  pets_cats: boolean;
  pets_dogs: boolean;
  pets_dog_size: string | null;
  pets_notes: string | null;
  heat_included: boolean;
  hydro_included: boolean;
  water_included: boolean;
  virtual_tour_url: string | null;
  org_name: string;
  brand_color: string;
  brand_color_secondary: string | null;
  logo_url: string | null;
  screening_enabled: boolean;
  screening_questions: {
    id: string;
    prompt: string;
    qtype: "text" | "yesno" | "choice" | "units";
    required: boolean;
    /**
     * Options for a 'choice' question (S294); empty for text/yesno. For a 'units'
     * question (S331) this is the org's OTHER available units, computed
     * dynamically by get_public_listing.
     */
    choices: string[];
  }[];
  photos: string[];
};

export default async function PublicListingPage({
  params,
  searchParams,
}: {
  params: { propertyId: string };
  searchParams: { submitted?: string; error?: string; p?: string };
}) {
  // Per-post tracking id carried by a tracked inquiry link (/r/<id>?p=<postId>).
  const trackedPostId =
    typeof searchParams.p === "string" ? searchParams.p : "";
  const supabase = createClient();
  const [{ data }, { data: avData }] = await Promise.all([
    supabase.rpc("get_public_listing", { p_property_id: params.propertyId }),
    supabase.rpc("get_public_availability", { p_property_id: params.propertyId }),
  ]);

  if (!data) notFound();
  const l = data as Listing;
  // A unit can be marked "leased" (or off-market) after its link is shared. The
  // public action RPCs (availability / inquiry / booking) hard-block anything
  // that isn't 'available'; the page must visibly reflect that instead of still
  // showing "Available now" + a booking form. (off-market returns no listing at
  // all above → 404; 'leased' still loads here so we can say it's gone.)
  const isAvailable = l.status === "available";
  // Guardrail: keep white-on-brand (header, button) and brand-on-white (price)
  // legible even when the tenant picked a pale color.
  const brand = accessibleBrand(l.brand_color || "#4f46e5");
  // Ombre brand surface (header band, primary buttons) when the tenant picked a
  // second stop; a solid otherwise. Both stops are legibility-guarded.
  const brandBg = brandGradientCss(l.brand_color, l.brand_color_secondary);

  // Tag this listing's address as the clustering target so generateSlots can
  // find the building's existing anchor window (a no-op unless the org enabled
  // clustering). target_address isn't known to the RPC, so inject it here.
  const av = avData as Availability | null;
  const avForSlots = av ? { ...av, target_address: l.address } : null;
  const days = avForSlots ? generateSlots(avForSlots) : [];
  const hasClustered = days.some((d) => d.slots.some((s) => s.clustered));

  const specs = buildSpecLine(l);
  const amenities = buildAmenityChips(l);
  const utilities = utilitiesSummary(l);
  const availability = formatAvailability(l.available_date);
  // Photos come pre-ordered from the RPC (cover first, then sort order).
  const photos = Array.isArray(l.photos) ? l.photos : [];

  // Virtual tour / video (item S). Re-validated here against the host allow-list
  // so a value that somehow slipped past the write path can never inject an
  // arbitrary iframe; embeddable hosts get an <iframe>, others a plain link.
  const tour = virtualTourFor(l.virtual_tour_url);

  // Soft, non-binding affordability guideline shown next to the screening
  // income question. Computed from the PUBLIC rent + a generic ~3x rule of
  // thumb — never the org's private screening_income_multiple (not exposed by
  // the RPC). Null when rent is unknown, so the tip simply doesn't render.
  const incomeHintCents = affordabilityHintIncomeCents(l.rent_cents);
  const rentMonthly = l.rent_cents ? Math.round(l.rent_cents / 100) : null;

  const booked = searchParams.submitted === "booked";
  // The renter's chosen time was taken before we could book it (audit B1). Their
  // inquiry is still saved; we tell them clearly and let them pick another time.
  const slotTaken = searchParams.submitted === "slottaken";
  // A slot-taken retry can rebook the ALREADY-saved lead (from the httpOnly
  // per-property cookie the submit action set) without re-collecting details or
  // duplicating the lead (P2c). Present only right after a slot-taken submit.
  const savedLeadId = slotTaken
    ? cookies().get(`vl_lead_${params.propertyId}`)?.value ?? ""
    : "";
  const canRebookSaved = Boolean(savedLeadId) && days.length > 0;

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        ["--brand-color" as string]: brand,
        ["--brand-gradient" as string]: brandBg,
      }}
    >
      <header
        className="relative text-white shadow-md"
        style={{ background: brandBg }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25"
        />
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
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {l.address}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xl font-bold" style={{ color: brand }}>
              {l.rent_cents
                ? `$${(l.rent_cents / 100).toLocaleString()}/mo`
                : "Contact for pricing"}
            </p>
            {isAvailable ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-100">
                <Icons.check className="h-3 w-3" />
                {availability}
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                No longer available
              </span>
            )}
          </div>
          {specs.length > 0 && (
            <p className="mt-2 text-sm text-gray-600">{specs.join(" · ")}</p>
          )}
          {amenities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {amenities.map((a) => (
                <span
                  key={a}
                  className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700"
                >
                  {a}
                </span>
              ))}
            </div>
          )}
          {utilities && (
            <p className="mt-3 text-sm font-medium text-gray-700">{utilities}</p>
          )}
          {l.pets_notes && l.pets_notes.trim() && (
            <p className="mt-2 text-sm text-gray-600">
              Pets: {l.pets_notes.trim()}
            </p>
          )}
          {/* Bring the booking action above the fold on mobile (Codex design
              audit #6): a renter sees how to act before scrolling past the photos
              and description. In-flow anchor jump — no JS, desktop unaffected. */}
          {isAvailable && (
            <a
              href="#book"
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:w-auto"
              style={{ background: brandBg }}
            >
              {days.length > 0 ? "Book a viewing" : "Request a viewing"}
              <span aria-hidden>↓</span>
            </a>
          )}
        </div>

        <PhotoGallery address={l.address} photos={photos} available={isAvailable} />

        {tour && (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 px-2 text-sm font-semibold text-gray-700">
              Virtual tour
            </h2>
            {tour.embedUrl ? (
              <div className="overflow-hidden rounded-xl bg-gray-100">
                <iframe
                  src={tour.embedUrl}
                  title={`Virtual tour of ${l.address}`}
                  className="aspect-video w-full"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; xr-spatial-tracking; fullscreen; vr"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
                />
              </div>
            ) : (
              <a
                href={tour.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mx-2 inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                style={{ background: brandBg }}
              >
                View the {tour.label}
              </a>
            )}
          </div>
        )}

        {l.description && (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="whitespace-pre-wrap leading-relaxed text-gray-700">
              {l.description}
            </p>
          </div>
        )}

        <div
          id="book"
          className="mt-6 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {!isAvailable ? (
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">
                This rental is no longer available
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {l.org_name} isn&apos;t taking inquiries for this listing right
                now. Please check back, or reach out about their other rentals.
              </p>
            </div>
          ) : slotTaken ? (
            <div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900">
                  That time was just taken
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  Someone booked that slot moments before you. We saved your
                  inquiry, so {l.org_name} can still reach out
                  {canRebookSaved
                    ? " — just pick another time below."
                    : ", but you can grab another time right now."}
                </p>
              </div>
              {canRebookSaved ? (
                // Booking-only retry against the saved lead — no personal fields,
                // no duplicate lead, attribution preserved (P2c).
                <form action={rebookSavedLead} className="mt-5 space-y-4">
                  <input type="hidden" name="property_id" value={l.id} />
                  {trackedPostId && (
                    <input
                      type="hidden"
                      name="listing_post_id"
                      value={trackedPostId}
                    />
                  )}
                  <fieldset className="rounded-lg border border-gray-200 p-4">
                    <legend className="px-1 text-sm font-medium text-gray-700">
                      Choose another viewing time
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
                                  required
                                  className="peer sr-only"
                                />
                                <span className="block rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:border-gray-400 peer-checked:border-[var(--brand-color)] peer-checked:bg-[var(--brand-color)] peer-checked:text-white">
                                  {s.label}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                  <button
                    type="submit"
                    className="w-full rounded-lg px-4 py-2.5 font-semibold text-white shadow-sm transition hover:opacity-90"
                    style={{ background: brandBg }}
                  >
                    Confirm new time
                  </button>
                </form>
              ) : (
                <div className="text-center">
                  <a
                    href={`/r/${l.id}${trackedPostId ? `?p=${encodeURIComponent(trackedPostId)}` : ""}`}
                    className="mt-4 inline-block rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                    style={{ background: brandBg }}
                  >
                    Choose another time
                  </a>
                </div>
              )}
            </div>
          ) : searchParams.submitted ? (
            <div className="text-center">
              <span
                className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm"
                style={{ background: brandBg }}
              >
                <Icons.check className="h-6 w-6" />
              </span>
              <h2 className="text-xl font-bold text-gray-900">
                {booked ? "Your viewing is booked!" : "Thanks, we got your inquiry!"}
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
                {days.length > 0 ? "Book a viewing" : "Request a viewing"}
              </h2>
              <p className="mb-1 mt-1 text-sm text-gray-500">
                {days.length > 0
                  ? "Pick a time that works for you, or just send your details and we'll reach out."
                  : "Tell us a bit about you and we'll reach out to book a time."}
              </p>
              <p className="mb-4 text-sm text-gray-500">
                This is an in-person viewing (not a phone call). You will visit the home at the address above.
              </p>
              {searchParams.error && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Sorry, something went wrong. Please try again.
                </p>
              )}
              <form action={submitLead} className="space-y-4">
                <input type="hidden" name="property_id" value={l.id} />
                {trackedPostId && (
                  <input
                    type="hidden"
                    name="listing_post_id"
                    value={trackedPostId}
                  />
                )}

                <div className="space-y-3">
                  <div>
                    <label htmlFor="r_name" className="mb-1 block text-sm font-medium text-gray-700">
                      Full name
                    </label>
                    <input
                      id="r_name"
                      name="name"
                      required
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="r_email" className="mb-1 block text-sm font-medium text-gray-700">
                        Email
                      </label>
                      <input
                        id="r_email"
                        name="email"
                        type="email"
                        required
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="r_phone" className="mb-1 block text-sm font-medium text-gray-700">
                        Phone
                      </label>
                      <input
                        id="r_phone"
                        name="phone"
                        type="tel"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                      <span className="mt-1 block text-xs text-gray-400">
                        If you share your number we may text you about this
                        viewing (such as a confirmation and reminders). Message
                        and data rates may apply. Reply STOP anytime to opt out.
                      </span>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="r_move_in" className="mb-1 block text-sm font-medium text-gray-700">
                      Desired move-in date{" "}
                      <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      id="r_move_in"
                      name="move_in"
                      type="date"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  {l.screening_enabled && (
                    // Screening questions are collapsed by default (S408): the
                    // public form should read as a quick inquiry, not a rental
                    // application, or renters bounce. Everything inside is
                    // optional; anyone who wants faster matching can expand it.
                    // Native <details> so it works with no client JS.
                    <details className="rounded-lg border border-gray-200 bg-gray-50/60">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700">
                        Add a few details to help us match you faster (optional)
                      </summary>
                      <fieldset className="space-y-3 border-t border-gray-200 p-4">
                        <legend className="sr-only">A few quick questions</legend>
                      <div>
                        <label htmlFor="r_income" className="mb-1 block text-sm font-medium text-gray-700">
                          Approximate monthly household income{" "}
                          <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                            $
                          </span>
                          <input
                            id="r_income"
                            name="screen_income"
                            type="text"
                            inputMode="numeric"
                            placeholder="4,500"
                            className="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm"
                          />
                        </div>
                        <span className="mt-1 block text-xs text-gray-400">
                          Helps us confirm the home fits your budget. Combined
                          household, before tax.
                        </span>
                        {incomeHintCents != null && rentMonthly != null && (
                          <span className="mt-1 block text-xs text-gray-500">
                            Tip: for a ${rentMonthly.toLocaleString()}/mo home,
                            renters often have a household income around $
                            {(incomeHintCents / 100).toLocaleString()}/mo. This
                            is a general guideline, not a strict requirement.
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="r_occupants" className="mb-1 block text-sm font-medium text-gray-700">
                            How many people would live here?{" "}
                            <span className="font-normal text-gray-400">(optional)</span>
                          </label>
                          <input
                            id="r_occupants"
                            name="screen_occupants"
                            type="number"
                            min={1}
                            max={20}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="r_pets_detail" className="mb-1 block text-sm font-medium text-gray-700">
                            Pets?{" "}
                            <span className="font-normal text-gray-400">(optional)</span>
                          </label>
                          <input
                            id="r_pets_detail"
                            name="screen_pets_detail"
                            type="text"
                            placeholder="e.g. 1 cat — or leave blank"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                          <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                            <input
                              name="screen_has_pets"
                              type="checkbox"
                              value="1"
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            I have a pet
                          </label>
                        </div>
                      </div>
                      {/* Operator-authored custom questions (S291). Field names
                          are cq_<id>; the submit action collects them and the RPC
                          re-validates against the org's active questions. */}
                      {(l.screening_questions ?? []).map((q) => {
                        // A 'units' question (S331) renders its dynamic option
                        // list of the org's OTHER available units. When there are
                        // none right now, the option list is empty — render
                        // nothing rather than an empty dropdown.
                        if (q.qtype === "units" && (q.choices?.length ?? 0) === 0) {
                          return null;
                        }
                        return (
                        <div key={q.id}>
                          <label htmlFor={`cq_${q.id}`} className="mb-1 block text-sm font-medium text-gray-700">
                            {q.prompt}{" "}
                            {!q.required && (
                              <span className="font-normal text-gray-400">
                                (optional)
                              </span>
                            )}
                          </label>
                          {q.qtype === "yesno" ? (
                            <select
                              id={`cq_${q.id}`}
                              name={`cq_${q.id}`}
                              required={q.required}
                              defaultValue=""
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-40"
                            >
                              <option value="">Select…</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          ) : q.qtype === "choice" || q.qtype === "units" ? (
                            <select
                              id={`cq_${q.id}`}
                              name={`cq_${q.id}`}
                              required={q.required}
                              defaultValue=""
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            >
                              <option value="">
                                {q.qtype === "units" ? "Select a unit…" : "Select…"}
                              </option>
                              {(q.choices ?? []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={`cq_${q.id}`}
                              name={`cq_${q.id}`}
                              type="text"
                              required={q.required}
                              maxLength={500}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                          )}
                        </div>
                        );
                      })}
                      </fieldset>
                    </details>
                  )}
                  <div>
                    <label htmlFor="r_notes" className="mb-1 block text-sm font-medium text-gray-700">
                      Anything else?
                    </label>
                    <textarea
                      id="r_notes"
                      name="notes"
                      rows={3}
                      placeholder={
                        l.screening_enabled
                          ? "Questions, or anything you'd like us to know…"
                          : "Number of occupants, pets, questions…"
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {days.length > 0 && (
                  <fieldset className="rounded-lg border border-gray-200 p-4">
                    <legend className="px-1 text-sm font-medium text-gray-700">
                      Choose a viewing time{" "}
                      <span className="font-normal text-gray-400">(optional)</span>
                    </legend>
                    <p className="mb-3 mt-1 text-xs text-gray-400">
                      Times shown in {av?.timezone?.replace(/_/g, " ")}.
                    </p>
                    {hasClustered && (
                      <p className="mb-3 -mt-2 text-xs text-gray-500">
                        These times group your visit with other viewings at this
                        building.
                      </p>
                    )}
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
                                <span className="block rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:border-gray-400 peer-checked:border-[var(--brand-color)] peer-checked:bg-[var(--brand-color)] peer-checked:text-white">
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
                  className="w-full rounded-lg px-4 py-2.5 font-semibold text-white shadow-sm transition hover:opacity-90"
                  style={{ background: brandBg }}
                >
                  {days.length > 0 ? "Confirm" : "Request a viewing"}
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
