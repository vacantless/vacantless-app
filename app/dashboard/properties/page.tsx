import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { propertyStatusLabel } from "@/lib/pipeline";
import { isPubliclyVisible, isPublicBookable } from "@/lib/listing-state";
import {
  StatusChip,
  propertyStatusTone,
  EmptyState,
  BrandBanner,
  SectionHeading,
  PRIMARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { rentalRowReadiness } from "@/lib/rental-readiness";
import { getCurrentOrg } from "@/lib/org";
import { canUseListingAiImport } from "@/lib/billing";
import { addProperty, importPropertyFromMls, importListingFromImages } from "./actions";
import { CopyIntakeButton } from "./copy-intake-button";
import { MlsPdfImport } from "./mls-pdf-import";
import { ListingImageImport } from "./listing-image-import";
import { ReadinessChips } from "./readiness-chips";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  status: string;
  description: string | null;
};

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: { added?: string; import?: string };
}) {
  const supabase = createClient();
  const [
    { data: properties },
    { data: leadRefs },
    { data: photoRefs },
    { count: availabilityCount },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, rent_cents, beds, baths, status, description")
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("property_id"),
    supabase.from("property_photos").select("property_id"),
    // Org-wide weekly viewing windows — the same signal the property-detail
    // share-readiness check uses. One count for the whole org (RLS-scoped), so
    // the "Viewings" readiness chip reflects whether ANY rental can be
    // self-booked once a renter lands.
    supabase
      .from("availability_rules")
      .select("id", { count: "exact", head: true }),
  ]);

  const rows = (properties ?? []) as PropertyRow[];

  // AI image import (Feature B Slice 2) is DARK: only surface the image-drop
  // path when the env flag is set AND the org's plan carries the entitlement
  // (Growth+). Off => the card isn't rendered and the page behaves exactly as
  // before. The server action re-checks this gate.
  const org = await getCurrentOrg();
  const aiImageImportEnabled =
    !!process.env.LISTING_AI_IMPORT_ENABLED && canUseListingAiImport(org?.plan);

  // Per-property inquiry counts (RLS already scopes both reads to this org).
  const leadCounts = new Map<string, number>();
  for (const r of (leadRefs ?? []) as { property_id: string | null }[]) {
    if (r.property_id) {
      leadCounts.set(r.property_id, (leadCounts.get(r.property_id) ?? 0) + 1);
    }
  }

  // Per-property photo counts — so a shareable-but-photo-poor rental can be
  // labelled at the list level (Codex QA: don't offer a bare "Copy link" with no
  // signal that the listing has no photos).
  const photoCounts = new Map<string, number>();
  for (const r of (photoRefs ?? []) as { property_id: string | null }[]) {
    if (r.property_id) {
      photoCounts.set(r.property_id, (photoCounts.get(r.property_id) ?? 0) + 1);
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
        title="Properties"
        subtitle="Your rentals and their marketing status."
      />

      {searchParams.added && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Property added as a draft. Open it to add photos and details, then set
          it Live to share its public inquiry page.
        </p>
      )}

      {searchParams.import === "empty" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Couldn&apos;t read any listing details from that text. Paste the
          listing from MLS or realtor.ca (address, rent, beds, baths, remarks),
          or add it manually with &ldquo;Start fresh.&rdquo;
        </p>
      )}
      {searchParams.import === "failed" && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Something went wrong creating the property. Please try again.
        </p>
      )}
      {searchParams.import === "badimage" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Those files weren&apos;t usable images. Upload a JPG, PNG, WebP, or GIF
          screenshot or photo of the listing (up to 8 MB each).
        </p>
      )}
      {searchParams.import === "aiempty" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Couldn&apos;t read any listing details from those images. Try a clearer
          shot, or add it manually with &ldquo;Start fresh.&rdquo;
        </p>
      )}
      {searchParams.import === "aifailed" && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Reading the images didn&apos;t work just now. Please try again in a
          moment, or add it manually with &ldquo;Start fresh.&rdquo;
        </p>
      )}
      {searchParams.import === "unavailable" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Image import isn&apos;t available on your plan right now. Add it
          manually with &ldquo;Start fresh,&rdquo; or import it from MLS or
          realtor.ca.
        </p>
      )}

      {/* Building standard policy entry point (S275 IA Step 3): the org-level
          defaults every unit inherits live here, with the portfolio they
          govern — relocated from Settings (G6/G7). Fresh-org audit P3: only
          surface it once there's at least one unit to govern; a zero-property
          org shouldn't be fronted with org-wide config before its first add. */}
      {rows.length > 0 && (
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
      )}

      {rows.length > 0 ? (
        <ul className="mb-8 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {rows.map((p) => {
            const readiness = rentalRowReadiness({
              status: p.status,
              rentCents: p.rent_cents,
              beds: p.beds,
              baths: p.baths,
              address: p.address,
              description: p.description,
              photoCount: photoCounts.get(p.id) ?? 0,
              availabilityWindowCount: availabilityCount ?? 0,
            });
            return (
            <li key={p.id} className="px-4 py-3">
              {/* Mobile (default): stack so the address/specs get their own
                  full-width row and the rent/status/actions cluster drops to a
                  separate wrapping row below — at true phone width the old
                  single justified row squeezed the address into one-word-per-
                  line wrapping beside the shrink-0 action cluster (Codex design
                  follow-up, pre-pilot). sm+ restores the original justified row. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-2">
              <Link
                href={`/dashboard/properties/${p.id}`}
                className="min-w-0 sm:flex-1 hover:underline"
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
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500">
                  {p.rent_cents
                    ? `$${(p.rent_cents / 100).toLocaleString()}/mo`
                    : "—"}
                </span>
                <StatusChip tone={propertyStatusTone(p.status)}>
                  {propertyStatusLabel(p.status)}
                </StatusChip>
                {isPublicBookable(p.status) ? (
                  // The photo-poor warning that used to sit here is now carried
                  // by the Photos chip in the readiness strip below (Codex design
                  // audit #5), so this stays a clean Copy action.
                  <>
                    <CopyIntakeButton url={intakeUrl(p.id)} />
                    <Link
                      href={`/dashboard/properties/${p.id}#distribute-header`}
                      className="rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
                      title="Open the marketing checklist. Nothing is posted automatically."
                    >
                      Marketing checklist →
                    </Link>
                  </>
                ) : isPubliclyVisible(p.status) ? (
                  // Leased / Paused: the public /r page LOADS but tells renters
                  // the unit is no longer available, so a bare "Copy inquiry
                  // link" reads like a Live listing. Label the state instead of
                  // offering an inquiry action (Codex QA re-review).
                  <span className="text-xs text-gray-400">
                    {p.status === "leased"
                      ? "Leased - page shows unavailable"
                      : "Paused - not accepting inquiries"}
                  </span>
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
              </div>
              {/* Readiness strip (Codex design audit #5): the four signals that
                  decide whether a rental can actually pull inquiries — link,
                  photos, viewings, feed — surfaced inline so an operator sees
                  what's missing without opening the rental. */}
              <ReadinessChips signals={readiness} />
            </li>
            );
          })}
        </ul>
      ) : (
        <div className="mb-8">
          <EmptyState
            icon={<Icons.building />}
            title="No properties yet"
            description="Add your first property to create its public inquiry page and start collecting inquiries - it takes a couple of minutes."
            cta={{ href: "#add-rental", label: "Add your first property" }}
          />
        </div>
      )}

      {/* Scroll target for the empty-state CTA. Keep the id stable for existing
          links while the product language says property. */}
      <div id="add-rental" className="scroll-mt-4" />
      <SectionHeading>Add a property</SectionHeading>

      {/* Fresh-org audit #3: lead with the simple, persona-neutral path. A small
          landlord with no MLS sheet enters an address and goes; the realtor
          MLS / realtor.ca import is demoted to the collapsible below, one click
          away, never the only or the first way in. */}
      <p className="mb-1 text-sm font-medium text-gray-800">
        Start fresh: enter the details yourself
      </p>
      <p className="mb-3 text-xs text-gray-500">
        Just an address creates a Draft; add rent, beds, baths, and photos now or
        later. Nothing goes public until you set it Live.
      </p>

      <form
        // Keyed on the post-submit nonce so a successful add REMOUNTS this form
        // and clears its uncontrolled inputs (soft-nav reuse would otherwise keep
        // the typed values — S226 QA-audit form-reset fix).
        key={`add-rental-${searchParams.added ?? "new"}`}
        action={addProperty}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="add_address" className="mb-1 block text-xs font-medium text-gray-600">
            Address
          </label>
          <input
            id="add_address"
            name="address"
            required
            placeholder="123 Main St, Unit 4"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-28">
          <label htmlFor="add_rent" className="mb-1 block text-xs font-medium text-gray-600">
            Rent ($/mo)
          </label>
          <input
            id="add_rent"
            name="rent"
            type="number"
            step="0.01"
            placeholder="1250"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-20">
          <label htmlFor="add_beds" className="mb-1 block text-xs font-medium text-gray-600">
            Beds
          </label>
          <input
            id="add_beds"
            name="beds"
            type="number"
            step="1"
            placeholder="2"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-20">
          <label htmlFor="add_baths" className="mb-1 block text-xs font-medium text-gray-600">
            Baths
          </label>
          <input
            id="add_baths"
            name="baths"
            type="number"
            step="0.5"
            placeholder="1"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-full">
          <label htmlFor="add_photos" className="mb-1 block text-xs font-medium text-gray-600">
            Photos{" "}
            <span className="font-normal text-gray-400">
              (optional — add them now so it&apos;s ready to share the moment you
              publish, or add them later)
            </span>
          </label>
          <input
            id="add_photos"
            name="photos"
            type="file"
            accept="image/*"
            multiple
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
        </div>
        <button
          type="submit"
          className={PRIMARY_ACTION_CLASS}
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Add property
        </button>
      </form>

      {/* Realtor import wedge (item M), demoted to a secondary collapsible
          (fresh-org audit #3): a realtor who already has the unit on MLS or
          realtor.ca prefills a Draft here instead of re-keying it, without the
          import box fronting the page for a landlord who has no data sheet.
          Opens automatically right after an import attempt so the banner above
          lines up with the box the operator just used. */}
      <details
        open={typeof searchParams.import === "string"}
        className="mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm"
      >
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-gray-800 [&::-webkit-details-marker]:hidden">
          Already have it on MLS or realtor.ca? Import it to prefill
        </summary>
        <div className="border-t border-gray-100 p-5 pt-4">
          <form
            key={`mls-import-${searchParams.import ?? "new"}`}
            action={importPropertyFromMls}
          >
            <label
              htmlFor="mls_text"
              className="mb-1 block text-sm font-medium text-gray-800"
            >
              Drop the data sheet or paste the listing to prefill
            </label>
            <p className="mb-3 text-xs text-gray-500">
              Drop the realtor data-sheet PDF you downloaded or emailed yourself,
              or paste the listing text (address, rent, beds/baths, square
              footage, remarks) — the whole realtor.ca page or a full MLS agent
              data sheet both work. We&apos;ll create a Draft with the details
              filled in for you to review; nothing goes public until you set it
              Live. Photos don&apos;t come across, so you&apos;ll add those after.
              Your own listing only; we don&apos;t pull from MLS.
            </p>
            <MlsPdfImport
              placeholder={
                "Paste your MLS or realtor.ca listing here, e.g.\nAddress: 123 Main St, Unit 4\nList Price: $1,950/Monthly\nBedrooms: 2\nBathrooms: 1\nRemarks: Bright two-bedroom with in-suite laundry..."
              }
            />
          </form>

          {/* AI image import (Feature B Slice 2) — only for a listing that
              exists as a picture. Rendered only when the flag + entitlement are
              on (DARK by default); the action re-checks the gate. */}
          {aiImageImportEnabled && (
            <form
              key={`img-import-${searchParams.import ?? "new"}`}
              action={importListingFromImages}
              encType="multipart/form-data"
              className="mt-5 border-t border-gray-100 pt-5"
            >
              <p className="mb-1 block text-sm font-medium text-gray-800">
                Only have a picture of the listing? Upload it to prefill
              </p>
              <p className="mb-3 text-xs text-gray-500">
                A screenshot of a Facebook or Kijiji post, a photo of a flyer, or
                a saved listing image, and we read the details into a Draft for
                you to review. Photos don&apos;t come across, so you&apos;ll add
                those after. Your own listing only.
              </p>
              <ListingImageImport />
            </form>
          )}
        </div>
      </details>
    </div>
  );
}
