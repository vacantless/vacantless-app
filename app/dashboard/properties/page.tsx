import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { propertyStatusLabel } from "@/lib/pipeline";
import {
  StatusChip,
  propertyStatusTone,
  EmptyState,
  BrandBanner,
  SectionHeading,
  PRIMARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { addProperty } from "./actions";
import { CopyIntakeButton } from "./copy-intake-button";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  status: string;
};

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: { added?: string };
}) {
  const supabase = createClient();
  const [{ data: properties }, { data: leadRefs }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, rent_cents, beds, baths, status")
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("property_id"),
  ]);

  const rows = (properties ?? []) as PropertyRow[];

  // Per-property inquiry counts (RLS already scopes both reads to this org).
  const leadCounts = new Map<string, number>();
  for (const r of (leadRefs ?? []) as { property_id: string | null }[]) {
    if (r.property_id) {
      leadCounts.set(r.property_id, (leadCounts.get(r.property_id) ?? 0) + 1);
    }
  }

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const intakeUrl = (id: string) =>
    host ? `${proto}://${host}/r/${id}` : `/r/${id}`;

  return (
    <div>
      <BrandBanner
        icon={<Icons.building />}
        eyebrow="Portfolio"
        title="Rentals"
        subtitle="Your rental portfolio. Each rental has its own public inquiry page and lead tracking."
      />

      {searchParams.added && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Rental added. Its public inquiry page is ready to share.
        </p>
      )}

      {rows.length > 0 ? (
        <ul className="mb-8 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
            >
              <Link
                href={`/dashboard/properties/${p.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <span className="text-gray-900">{p.address}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {[
                    p.beds != null ? `${p.beds} bd` : null,
                    p.baths != null ? `${p.baths} ba` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {(leadCounts.get(p.id) ?? 0) > 0 && (
                  <span className="ml-2 text-xs font-medium text-gray-500">
                    · {leadCounts.get(p.id)}{" "}
                    {leadCounts.get(p.id) === 1 ? "inquiry" : "inquiries"}
                  </span>
                )}
              </Link>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-gray-500">
                  {p.rent_cents
                    ? `$${(p.rent_cents / 100).toLocaleString()}/mo`
                    : "—"}
                </span>
                <StatusChip tone={propertyStatusTone(p.status)}>
                  {propertyStatusLabel(p.status)}
                </StatusChip>
                <CopyIntakeButton url={intakeUrl(p.id)} />
                <Link
                  href={`/dashboard/properties/${p.id}`}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Edit
                </Link>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-8">
          <EmptyState
            icon={<Icons.building />}
            title="No rentals yet"
            description="Add your first rental below to create its public inquiry page and start collecting inquiries."
          />
        </div>
      )}

      <SectionHeading>Add a rental</SectionHeading>
      <form
        // Keyed on the post-submit nonce so a successful add REMOUNTS this form
        // and clears its uncontrolled inputs (soft-nav reuse would otherwise keep
        // the typed values — S226 QA-audit form-reset fix).
        key={`add-rental-${searchParams.added ?? "new"}`}
        action={addProperty}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
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
          className={PRIMARY_ACTION_CLASS}
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Add rental
        </button>
      </form>
    </div>
  );
}
