import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { propertyStatusLabel } from "@/lib/pipeline";
import { StatusChip, propertyStatusTone, EmptyState } from "@/components/ui";
import { addProperty } from "./actions";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  status: string;
};

export default async function PropertiesPage() {
  const supabase = createClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, address, rent_cents, beds, baths, status")
    .order("created_at", { ascending: false });

  const rows = (properties ?? []) as PropertyRow[];

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-gray-900">Properties</h2>

      {rows.length > 0 ? (
        <ul className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/properties/${p.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="text-gray-900">{p.address}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {[
                      p.beds != null ? `${p.beds} bd` : null,
                      p.baths != null ? `${p.baths} ba` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-gray-500">
                    {p.rent_cents
                      ? `$${(p.rent_cents / 100).toLocaleString()}/mo`
                      : "—"}
                  </span>
                  <StatusChip tone={propertyStatusTone(p.status)}>
                    {propertyStatusLabel(p.status)}
                  </StatusChip>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-8">
          <EmptyState
            title="No properties yet"
            description="Add your first property below to generate its public intake page and start collecting leads."
          />
        </div>
      )}

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Add a property
      </h3>
      <form
        action={addProperty}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div className="min-w-[16rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Address
          </label>
          <input
            name="address"
            required
            placeholder="833 Pillette Rd, Unit 20"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Rent ($/mo)
          </label>
          <input
            name="rent"
            type="number"
            step="1"
            placeholder="1250"
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
            placeholder="2"
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
            placeholder="1"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Add property
        </button>
      </form>
    </div>
  );
}
