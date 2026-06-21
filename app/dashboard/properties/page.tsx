import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { propertyStatusLabel } from "@/lib/pipeline";
import { isPubliclyVisible } from "@/lib/listing-state";
import {
  StatusChip,
  propertyStatusTone,
  EmptyState,
  BrandBanner,
  SectionHeading,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { addProperty, importPropertyFromMls } from "./actions";
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
  searchParams: { added?: string; import?: string };
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
        subtitle="Your rental portfolio. Each rental has its own public inquiry page and renter inquiry tracking."
      />

      {searchParams.added && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Rental added. Its public inquiry page is ready to share.
        </p>
      )}

      {searchParams.import === "empty" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Couldn&apos;t read any listing details from that text. Paste the
          listing from MLS or realtor.ca (address, rent, beds, baths, remarks),
          or use &ldquo;Start fresh&rdquo; below.
        </p>
      )}
      {searchParams.import === "failed" && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Something went wrong creating the rental. Please try again.
        </p>
      )}

      {/* Building standard policy entry point (S275 IA Step 3): the org-level
          defaults every unit inherits live here, with the portfolio they
          govern — relocated from Settings (G6/G7). */}
      <Link
        href="/dashboard/properties/standard-policy"
        className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2.5 text-gray-700">
          <Icons.building className="h-4 w-4 text-gray-400" />
          <span>
            <span className="font-medium text-gray-900">
              Building standard policy
            </span>{" "}
            — set lease term, A/C, smoking, and on-site management once; every
            unit inherits it.
          </span>
        </span>
        <span className="shrink-0 font-medium text-brand">Manage →</span>
      </Link>

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
                {isPubliclyVisible(p.status) ? (
                  <CopyIntakeButton url={intakeUrl(p.id)} />
                ) : (
                  // Draft / off-market: the public /r link 404s, so don't offer
                  // a Copy button that hands out a broken link (QA blocker #1).
                  <span className="text-xs text-gray-400">
                    Set Live to share
                  </span>
                )}
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

      {/* Realtor onboarding wedge (item M): paste an existing MLS / realtor.ca
          listing to prefill a draft, so a realtor who already has the unit on
          MLS doesn't re-key it. The "Start fresh" form below stays a first-class
          path — MLS is never the only way in. */}
      <form
        key={`mls-import-${searchParams.import ?? "new"}`}
        action={importPropertyFromMls}
        className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <label
          htmlFor="mls_text"
          className="mb-1 block text-sm font-medium text-gray-800"
        >
          Have it on MLS or realtor.ca? Paste the listing to prefill
        </label>
        <p className="mb-2 text-xs text-gray-500">
          Copy the listing text (address, rent, beds/baths, square footage,
          remarks) — the whole realtor.ca page or a full MLS agent data sheet
          both work — and paste it here. We&apos;ll create a Draft with the
          details filled in for you to
          review; nothing goes public until you set it Live. Photos don&apos;t
          come across, so you&apos;ll add those after. Your own listing text
          only; we don&apos;t pull from MLS.
        </p>
        <textarea
          id="mls_text"
          name="mls_text"
          rows={5}
          placeholder={
            "Paste your MLS or realtor.ca listing here, e.g.\nAddress: 123 Main St, Unit 4\nList Price: $1,950/Monthly\nBedrooms: 2\nBathrooms: 1\nRemarks: Bright two-bedroom with in-suite laundry..."
          }
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            className={SECONDARY_ACTION_CLASS}
          >
            Prefill from listing
          </button>
        </div>
      </form>

      <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-gray-400">
        or start fresh
      </p>

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
            placeholder="123 Main St, Unit 4"
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
