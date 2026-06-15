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
import { updateProperty } from "../actions";
import { CopyLink } from "./copy-link";

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
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  status: LeadStatus;
  created_at: string;
};

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { saved?: string };
}) {
  const supabase = createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id, address, rent_cents, beds, baths, parking, description, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!property) notFound();
  const p = property as Property;

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, status, created_at")
    .eq("property_id", p.id)
    .order("created_at", { ascending: false });
  const leadRows = (leads ?? []) as LeadRow[];

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
