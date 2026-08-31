import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { submitLead, rebookSavedLead, joinWaitlist } from "./actions";
import { InquiryForm } from "./inquiry-form";
import { PhotoGallery } from "./photo-gallery";
import { generateSlots, type Availability } from "@/lib/booking";
import { affordabilityHintIncomeCents } from "@/lib/screening";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { Icons } from "@/components/icons";
import {
  buildSpecLine,
  buildAmenityChips,
  formatAvailability,
  utilitiesSummary,
} from "@/lib/property-features";
import { virtualTourFor } from "@/lib/virtual-tour";
import {
  buildListingJsonLd,
  buildListingMetaDescription,
  buildListingMetaTitle,
  jsonLdScriptText,
  leadSourceHintFromParam,
} from "@/lib/listing-seo";
import { parseCityFromAddress } from "@/lib/browse-surface";
import {
  publicAddressLabel,
  type AddressDisplayMode,
} from "@/lib/address-privacy";
import {
  leadAttributionReferrerEnabled,
  normalizeLeadUtmSource,
} from "@/lib/lead-attribution";

export const dynamic = "force-dynamic";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

type Listing = {
  id: string;
  address: string;
  address_display_mode?: AddressDisplayMode | null;
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
  // S490: when true, booked-copy tells renters an agent will confirm first.
  // Older RPC payloads omit it -> default false below, preserving current copy.
  booking_requires_confirmation?: boolean;
  // Per-built-in ask toggles (S438 Slice 2). Default true from get_public_listing,
  // so an older listing payload without these keys reads as undefined -> the form
  // coalesces to true (asks the built-in) and behavior is unchanged.
  screening_ask_income?: boolean;
  screening_ask_movein?: boolean;
  screening_ask_pets?: boolean;
  screening_ask_occupants?: boolean;
  // S629: org-scoped "require a phone number on inquiries". Older RPC payloads
  // omit it -> undefined -> the form coalesces to false (phone optional).
  inquiry_require_phone?: boolean;
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

type OpenSibling = {
  id: string;
  address: string;
  address_display_mode?: AddressDisplayMode | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  available_date: string | null;
};

function parseOpenSiblings(value: unknown): OpenSibling[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): OpenSibling | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const address = typeof row.address === "string" ? row.address : "";
      if (!id || !address) return null;
      const rent =
        typeof row.rent_cents === "number" && Number.isFinite(row.rent_cents)
          ? row.rent_cents
          : null;
      const beds =
        typeof row.beds === "number" && Number.isFinite(row.beds)
          ? row.beds
          : null;
      const baths =
        typeof row.baths === "number" && Number.isFinite(row.baths)
          ? row.baths
          : null;
      return {
        id,
        address,
        address_display_mode:
          row.address_display_mode === "hide_unit" ||
          row.address_display_mode === "approximate"
            ? row.address_display_mode
            : "full",
        rent_cents: rent,
        beds,
        baths,
        available_date:
          typeof row.available_date === "string" ? row.available_date : null,
      };
    })
    .filter((item): item is OpenSibling => item != null);
}

function siblingSummary(sibling: OpenSibling): string {
  const parts = [
    sibling.rent_cents
      ? `$${(sibling.rent_cents / 100).toLocaleString()}/mo`
      : null,
    sibling.beds != null
      ? `${sibling.beds} bed${sibling.beds === 1 ? "" : "s"}`
      : null,
    sibling.baths != null ? `${sibling.baths} bath` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

const loadPublicListing = cache(async (propertyId: string): Promise<Listing | null> => {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_public_listing", {
    p_property_id: propertyId,
  });
  return (data as Listing | null) ?? null;
});

function displayAddressFor(
  listing: Pick<Listing | OpenSibling, "address" | "address_display_mode">,
): string {
  return publicAddressLabel({
    address: listing.address,
    city: parseCityFromAddress(listing.address),
    mode: listing.address_display_mode,
  });
}

export async function generateMetadata({
  params,
}: {
  params: { propertyId: string };
}): Promise<Metadata> {
  const listing = await loadPublicListing(params.propertyId);
  if (!listing) {
    return {
      title: "Rental listing | Vacantless",
      robots: { index: false },
    };
  }

  const publicListing = { ...listing, address: displayAddressFor(listing) };
  const title = buildListingMetaTitle(publicListing);
  const description = buildListingMetaDescription(publicListing);
  const coverPhoto = Array.isArray(listing.photos)
    ? listing.photos.find((photo) => photo && photo.trim())
    : null;
  const metadata: Metadata = {
    title,
    description,
  };

  if (coverPhoto) {
    metadata.openGraph = {
      title,
      description,
      images: [coverPhoto],
    };
  }

  if (listing.status !== "available") {
    metadata.robots = { index: false };
  }

  return metadata;
}

export default async function PublicListingPage({
  params,
  searchParams,
}: {
  params: { propertyId: string };
  searchParams: {
    submitted?: string;
    error?: string;
    p?: string;
    waitlist?: string;
    src?: string | string[];
    utm_source?: string | string[];
  };
}) {
  // Per-post tracking id carried by a tracked inquiry link (/r/<id>?p=<postId>).
  const trackedPostId =
    typeof searchParams.p === "string" ? searchParams.p : "";
  const sourceHint = leadSourceHintFromParam(searchParams.src);
  const attributionEnabled = leadAttributionReferrerEnabled();
  const utmSource = attributionEnabled
    ? normalizeLeadUtmSource(searchParams.utm_source)
    : null;
  const supabase = createClient();
  const [listing, { data: avData }, { data: siblingData }] = await Promise.all([
    loadPublicListing(params.propertyId),
    supabase.rpc("get_public_availability", { p_property_id: params.propertyId }),
    supabase.rpc("get_public_leaseup_siblings", {
      p_property_id: params.propertyId,
    }),
  ]);

  if (!listing) notFound();
  const l = listing;
  const openSiblings = parseOpenSiblings(siblingData);
  // Portal syndication feeds still use the full address; this masks only
  // Vacantless-hosted public surfaces.
  const displayAddress = displayAddressFor(l);
  const displayOpenSiblings = openSiblings.map((sibling) => ({
    ...sibling,
    displayAddress: displayAddressFor(sibling),
  }));
  // A unit can be marked "leased" or off-market after its link is shared. The
  // public action RPCs (availability / inquiry / booking) hard-block anything
  // that isn't 'available'; the page must visibly reflect that instead of still
  // showing "Available now" + a booking form. Both statuses load here so we can
  // say it's gone and offer the open siblings. Only 'draft' 404s, because a
  // draft was never published. (Migration 0223; before it, off-market 404'd and
  // every shared link to an archived unit died.)
  const isAvailable = l.status === "available";
  // Guardrail: keep white-on-brand (header, button) and brand-on-white (price)
  // legible even when the tenant picked a pale color.
  const brand = accessibleBrand(l.brand_color || DEFAULT_BRAND_COLOR);
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
  const canonicalUrl = `${APP_URL.replace(/\/+$/g, "")}/r/${encodeURIComponent(l.id)}`;
  const listingHrefParams = new URLSearchParams();
  if (trackedPostId) listingHrefParams.set("p", trackedPostId);
  if (sourceHint) listingHrefParams.set("src", sourceHint);
  if (utmSource) listingHrefParams.set("utm_source", utmSource);
  const listingHrefQuery = listingHrefParams.toString();
  const listingHref = `/r/${l.id}${listingHrefQuery ? `?${listingHrefQuery}` : ""}`;

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

  // Move-in pill choices for the tap-first booking form (S409 BUILD 2). Computed
  // server-side (not in the client component) so the two upcoming month labels
  // don't cause a hydration mismatch. CRITICAL: the submit RPC's p_move_in is a
  // DATE (used in the move-in-window qualify-out), so every pill VALUE must be an
  // ISO date or empty — the human label is display-only. "As soon as possible" =
  // today; the two month pills = the 1st of the next two months; "Flexible" = no
  // date (empty -> null), distinguished from "unselected" by the pill's own key
  // in the client component.
  const isoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const nowForMoveIn = new Date();
  const monthPill = (offset: number) => {
    const d = new Date(
      nowForMoveIn.getFullYear(),
      nowForMoveIn.getMonth() + offset,
      1,
    );
    return {
      label: d.toLocaleString("en-US", { month: "short", year: "numeric" }),
      value: isoDate(d),
    };
  };
  const moveInPills = [
    { label: "As soon as possible", value: isoDate(nowForMoveIn) },
    monthPill(1),
    monthPill(2),
    { label: "Flexible", value: "" },
  ];

  const booked = searchParams.submitted === "booked";
  const bookingRequiresConfirmation =
    l.booking_requires_confirmation === true;
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
      {isAvailable && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScriptText(
              buildListingJsonLd({ ...l, address: displayAddress }, { canonicalUrl }),
            ),
          }}
        />
      )}
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
            {displayAddress}
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

        <PhotoGallery address={displayAddress} photos={photos} available={isAvailable} />

        {tour && (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 px-2 text-sm font-semibold text-gray-700">
              Virtual tour
            </h2>
            {tour.embedUrl ? (
              <div className="overflow-hidden rounded-xl bg-gray-100">
                <iframe
                  src={tour.embedUrl}
                  title={`Virtual tour of ${displayAddress}`}
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
            searchParams.waitlist === "joined" ? (
              <div className="text-center">
                <span
                  className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm"
                  style={{ background: brandBg }}
                >
                  <Icons.check className="h-6 w-6" />
                </span>
                <h2 className="text-xl font-bold text-gray-900">
                  You&apos;re on the waiting list
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  {l.org_name} will email you as soon as this rental is available
                  again.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-center">
                  <h2 className="text-xl font-bold text-gray-900">
                    This rental is no longer available
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">
                    {displayOpenSiblings.length > 0
                      ? `${l.org_name} has other rentals available now. You can also join the waiting list for this one.`
                      : `Want it if it opens up again? Join the waiting list and ${l.org_name} will email you the moment it's available.`}
                  </p>
                </div>
                {displayOpenSiblings.length > 0 ? (
                  <div className="mt-5 border-y border-gray-100 py-4">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Available now
                    </h3>
                    <div className="mt-3 divide-y divide-gray-100">
                      {displayOpenSiblings.map((sibling) => {
                        const hrefParams = new URLSearchParams();
                        if (sourceHint) hrefParams.set("src", sourceHint);
                        if (utmSource) hrefParams.set("utm_source", utmSource);
                        const siblingQuery = hrefParams.toString();
                        const href = `/r/${sibling.id}${siblingQuery ? `?${siblingQuery}` : ""}`;
                        return (
                          <a
                            key={sibling.id}
                            href={href}
                            className="flex items-center justify-between gap-3 py-3 text-left transition hover:text-[var(--brand-color)]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-gray-900">
                                {sibling.displayAddress}
                              </span>
                              {siblingSummary(sibling) ? (
                                <span className="mt-0.5 block text-xs text-gray-500">
                                  {siblingSummary(sibling)}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-xs font-semibold text-[var(--brand-color)]">
                              View
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {searchParams.waitlist === "needcontact" ? (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                    Please add an email or phone so we can reach you.
                  </p>
                ) : null}
                <form action={joinWaitlist} className="mt-5 space-y-4">
                  <input type="hidden" name="property_id" value={l.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Name
                      </label>
                      <input
                        name="name"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Email
                      </label>
                      <input
                        name="email"
                        type="email"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                        placeholder="name@example.com"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Phone
                      </label>
                      <input
                        name="phone"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                        placeholder="(519) 555-1212"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Ideal move-in (optional)
                      </label>
                      <input
                        name="move_in_by"
                        type="date"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg px-4 py-2.5 font-semibold text-white shadow-sm transition hover:opacity-90"
                    style={{ background: brandBg }}
                  >
                    Join the waiting list
                  </button>
                  <p className="text-center text-xs text-gray-400">
                    We&apos;ll only use this to tell you when this rental opens up.
                  </p>
                </form>
              </div>
            )
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
                  {sourceHint && (
                    <input type="hidden" name="src" value={sourceHint} />
                  )}
                  {utmSource && (
                    <input type="hidden" name="utm_source" value={utmSource} />
                  )}
                  <fieldset className="rounded-lg border border-gray-200 p-4">
                    <legend className="px-1 text-sm font-medium text-gray-700">
                      Choose another viewing time
                    </legend>
                    {av?.timezone && (
                      <p className="mb-3 mt-1 text-xs text-gray-400">
                        Times shown in {av.timezone.replace(/_/g, " ")}.
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
                    href={listingHref}
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
                {booked
                  ? bookingRequiresConfirmation
                    ? "Your viewing request is in!"
                    : "Your viewing is booked!"
                  : "Thanks, we got your inquiry!"}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {booked
                  ? bookingRequiresConfirmation
                    ? `We've emailed you the details. Someone from ${l.org_name} will reach out to confirm before your viewing.`
                    : `We've emailed you the details. ${l.org_name} will see you then.`
                  : `The team at ${l.org_name} will be in touch shortly to set up a viewing.`}
              </p>
            </div>
          ) : (
            <InquiryForm
              action={submitLead}
              propertyId={l.id}
              trackedPostId={trackedPostId}
              sourceHint={sourceHint}
              utmSource={utmSource}
              leadAttributionReferrerEnabled={attributionEnabled}
              orgName={l.org_name}
              brandBg={brandBg}
              brandColor={brand}
              timezone={av?.timezone}
              days={days}
              hasClustered={hasClustered}
              showError={Boolean(searchParams.error)}
              screeningEnabled={l.screening_enabled}
              askIncome={l.screening_ask_income ?? true}
              askMovein={l.screening_ask_movein ?? true}
              askPets={l.screening_ask_pets ?? true}
              askOccupants={l.screening_ask_occupants ?? true}
              screeningQuestions={l.screening_questions ?? []}
              incomeHintCents={incomeHintCents}
              rentMonthly={rentMonthly}
              moveInPills={moveInPills}
              petFriendly={l.pet_friendly}
              requirePhone={l.inquiry_require_phone ?? false}
            />
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Powered by Vacantless
        </p>
      </main>
    </div>
  );
}
