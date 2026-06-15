import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  PROPERTY_STATUSES,
  propertyStatusLabel,
  statusLabel,
  type LeadStatus,
} from "@/lib/pipeline";
import { updateProperty, blastPriceDrop } from "../actions";
import { CopyLink } from "./copy-link";
import {
  countEligible,
  blastOfferable,
  formatRentLabel,
} from "@/lib/price-drop";
import { LAUNDRY_OPTIONS, laundryLabel } from "@/lib/property-features";

export const dynamic = "force-dynamic";

type Property = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  parking: string | null;
  description: string | null;
  status: string;
  price_drop_pending_cents: number | null;
  available_date: string | null;
  sqft: number | null;
  floor: string | null;
  laundry: string | null;
  air_conditioning: boolean;
  balcony: boolean;
  furnished: boolean;
  pet_friendly: boolean;
  heat_included: boolean;
  hydro_included: boolean;
  water_included: boolean;
  photos_ready: boolean;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  status: LeadStatus;
  price_drop_notified_cents: number | null;
  created_at: string;
};

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { saved?: string; blasted?: string };
}) {
  const supabase = createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, address, rent_cents, beds, baths, parking, description, status, price_drop_pending_cents, available_date, sqft, floor, laundry, air_conditioning, balcony, furnished, pet_friendly, heat_included, hydro_included, water_included, photos_ready",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!property) notFound();
  const p = property as Property;

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, status, price_drop_notified_cents, created_at")
    .eq("property_id", p.id)
    .order("created_at", { ascending: false });
  const leadRows = (leads ?? []) as LeadRow[];

  const eligibleCount = countEligible(leadRows, p.rent_cents);
  const showBlastCard = blastOfferable(
    p.price_drop_pending_cents,
    p.rent_cents,
    eligibleCount,
  );
  const blastedCount =
    searchParams.blasted != null ? Number(searchParams.blasted) : null;

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicUrl = host ? `${proto}://${host}/r/${p.id}` : `/r/${p.id}`;

  return (
    <div>
      <Link
        href="/dashboard/properties"
        className="text-sm font-medium text-brand"
      >
        ← Properties
      </Link>

      {searchParams.saved && (
        <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Changes saved.
        </p>
      )}

      {blastedCount != null && (
        <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {blastedCount > 0
            ? `Price-drop alert sent to ${blastedCount} ${
                blastedCount === 1 ? "lead" : "leads"
              }.`
            : "No leads were eligible for a price-drop alert."}
        </p>
      )}

      <h2 className="mb-1 mt-3 text-xl font-bold text-gray-900">{p.address}</h2>
      <p className="mb-6 text-sm text-gray-500">
        {propertyStatusLabel(p.status)}
        {p.rent_cents
          ? ` · $${(p.rent_cents / 100).toLocaleString()}/mo`
          : ""}
      </p>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">
          Public listing link
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          Share this branded page on Kijiji, Facebook, email — inquiries land
          straight in your pipeline.
        </p>
        <CopyLink url={publicUrl} />
      </div>

      {showBlastCard && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-1 text-sm font-semibold text-amber-900">
            Price dropped — notify past leads
          </h3>
          <p className="mb-3 text-xs text-amber-800">
            You reduced the rent from{" "}
            <span className="line-through">
              {formatRentLabel(p.price_drop_pending_cents)}
            </span>{" "}
            to <strong>{formatRentLabel(p.rent_cents)}</strong>.{" "}
            {eligibleCount} open {eligibleCount === 1 ? "lead" : "leads"} who
            inquired earlier {eligibleCount === 1 ? "hasn't" : "haven't"} been
            told. Email them a branded alert with a link back to the listing.
          </p>
          <form action={blastPriceDrop}>
            <input type="hidden" name="id" value={p.id} />
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Notify {eligibleCount} {eligibleCount === 1 ? "lead" : "leads"} of
              the price drop
            </button>
          </form>
        </div>
      )}

      <form
        action={updateProperty}
        className="mb-8 space-y-4 rounded-lg border border-gray-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={p.id} />
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Address
          </label>
          <input
            name="address"
            required
            defaultValue={p.address}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Rent ($/mo)
            </label>
            <input
              name="rent"
              type="number"
              step="1"
              defaultValue={p.rent_cents != null ? p.rent_cents / 100 : ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Beds
            </label>
            <input
              name="beds"
              type="number"
              step="1"
              defaultValue={p.beds ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Baths
            </label>
            <input
              name="baths"
              type="number"
              step="0.5"
              defaultValue={p.baths ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Parking
            </label>
            <input
              name="parking"
              defaultValue={p.parking ?? ""}
              placeholder="1 spot"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Status
            </label>
            <select
              name="status"
              defaultValue={p.status}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {PROPERTY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {propertyStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Description
          </label>
          <textarea
            name="description"
            rows={4}
            defaultValue={p.description ?? ""}
            placeholder="Bright 2-bedroom with in-suite laundry, close to transit…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {/* --- Unit details --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Unit details
          </legend>
          <div className="flex flex-wrap gap-4">
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Available date
              </label>
              <input
                name="available_date"
                type="date"
                defaultValue={p.available_date ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">Blank = available now</p>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Size (sq ft)
              </label>
              <input
                name="sqft"
                type="number"
                step="1"
                min="0"
                defaultValue={p.sqft ?? ""}
                placeholder="850"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Floor
              </label>
              <input
                name="floor"
                defaultValue={p.floor ?? ""}
                placeholder="2nd"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Laundry
              </label>
              <select
                name="laundry"
                defaultValue={p.laundry ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Not specified</option>
                {LAUNDRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {laundryLabel(opt)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* --- Amenities --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Amenities
          </legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ["air_conditioning", "Air conditioning", p.air_conditioning],
                ["balcony", "Balcony", p.balcony],
                ["furnished", "Furnished", p.furnished],
                ["pet_friendly", "Pet friendly", p.pet_friendly],
              ] as const
            ).map(([name, label, checked]) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* --- Utilities included in rent --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Utilities included in rent
          </legend>
          <p className="mb-3 text-xs text-gray-400">
            Leave a utility unchecked if the tenant pays it.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ["heat_included", "Heat", p.heat_included],
                ["hydro_included", "Hydro", p.hydro_included],
                ["water_included", "Water", p.water_included],
              ] as const
            ).map(([name, label, checked]) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* --- Internal (operator-only) --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Internal
          </legend>
          <p className="mb-3 text-xs text-gray-400">
            Not shown to renters.
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="photos_ready"
              defaultChecked={p.photos_ready}
              className="h-4 w-4 rounded border-gray-300"
            />
            Listing photos ready
          </label>
        </fieldset>

        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Save changes
        </button>
      </form>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Leads for this property ({leadRows.length})
      </h3>
      {leadRows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
          No inquiries yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {leadRows.map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <span className="text-gray-900">
                  {l.name || l.email || "Unnamed lead"}
                </span>
                <span className="text-xs font-medium text-gray-500">
                  {statusLabel(l.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
