import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { statusLabel, type LeadStatus } from "@/lib/pipeline";
import {
  PROPERTY_STATUSES,
  propertyStatusLabel,
  propertyStatusHelp,
  propertyStatusBadge,
  isPublicBookable,
  isPubliclyVisible,
} from "@/lib/listing-state";
import {
  PageHeader,
  SectionHeading,
  StatusChip,
  leadStatusTone,
  EmptyState,
  IconTile,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { DescriptionGuide } from "@/components/description-guide";
import {
  updateProperty,
  duplicateProperty,
  blastPriceDrop,
  addListingPost,
  updateListingPost,
  removeListingPost,
  uploadPropertyPhotos,
  setCoverPhoto,
  movePhoto,
  deletePhoto,
} from "../actions";
import {
  buildAllListingCopy,
  copyPortalLabel,
} from "@/lib/listing-copy";
import { ListingCopyCard } from "./listing-copy-card";
import { buildShareReadiness } from "@/lib/share-readiness";
import {
  MAX_PHOTOS_PER_PROPERTY,
  sortPhotos,
  uploadErrorMessage,
} from "@/lib/photos";
import { CopyLink } from "./copy-link";
import {
  countEligible,
  blastOfferable,
  formatRentLabel,
} from "@/lib/price-drop";
import {
  LAUNDRY_OPTIONS,
  laundryLabel,
  DOG_SIZE_OPTIONS,
  dogSizeLabel,
} from "@/lib/property-features";
import {
  PORTALS,
  LISTING_POST_STATUSES,
  portalLabel,
  listingPostStatusLabel,
  listingPostErrorMessage,
  buildTrackedLink,
  countLeadsByPost,
  type PortalKey,
  type ListingPostStatus,
} from "@/lib/listing-distribution";

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
  pets_cats: boolean;
  pets_dogs: boolean;
  pets_dog_size: string | null;
  pets_notes: string | null;
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
  listing_post_id: string | null;
  created_at: string;
};

type ListingPostRow = {
  id: string;
  portal: PortalKey;
  label: string | null;
  url: string | null;
  status: ListingPostStatus;
  posted_on: string | null;
  notes: string | null;
};

type PhotoRow = {
  id: string;
  url: string;
  sort_order: number;
  is_cover: boolean;
};

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    saved?: string;
    blasted?: string;
    post?: string;
    pn?: string; // post-submit nonce that remounts the add-post form (form reset)
    posterr?: string;
    photos?: string;
    photoerr?: string;
    duplicated?: string;
    imported?: string;
  };
}) {
  const supabase = createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, address, rent_cents, beds, baths, parking, description, status, price_drop_pending_cents, available_date, sqft, floor, laundry, air_conditioning, balcony, furnished, pet_friendly, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, photos_ready",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!property) notFound();
  const p = property as Property;

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, name, email, status, price_drop_notified_cents, listing_post_id, created_at",
    )
    .eq("property_id", p.id)
    .order("created_at", { ascending: false });
  const leadRows = (leads ?? []) as LeadRow[];

  const { data: posts } = await supabase
    .from("listing_posts")
    .select("id, portal, label, url, status, posted_on, notes")
    .eq("property_id", p.id)
    .order("created_at", { ascending: true });
  const postRows = (posts ?? []) as ListingPostRow[];
  const postCounts = countLeadsByPost(leadRows);

  const { data: photos } = await supabase
    .from("property_photos")
    .select("id, url, sort_order, is_cover")
    .eq("property_id", p.id);
  const photoRows = sortPhotos((photos ?? []) as PhotoRow[]);
  const atPhotoLimit = photoRows.length >= MAX_PHOTOS_PER_PROPERTY;

  // Org-wide weekly viewing windows — one signal in the share-readiness check
  // below ("can a renter actually self-book a viewing once they land?").
  const { count: availabilityCount } = await supabase
    .from("availability_rules")
    .select("id", { count: "exact", head: true });

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

  // Is the public /r page actually reachable? Draft + off_market 404, so the
  // link is broken and must NOT be handed out anywhere (QA blocker #1).
  const linkIsLive = isPubliclyVisible(p.status);

  // Ready-to-paste per-channel listing copy, built from this unit's real fields.
  // Omit the public link entirely for a non-live rental so the generated copy
  // never embeds a URL that 404s; the copy falls back to "Contact us to book a
  // viewing." until the rental goes Live.
  const org = await getCurrentOrg();
  const copyTabs = buildAllListingCopy({
    businessName: org?.name ?? null,
    address: p.address,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    description: p.description,
    publicUrl: linkIsLive ? publicUrl : null,
    features: {
      available_date: p.available_date,
      sqft: p.sqft,
      floor: p.floor,
      parking: p.parking,
      laundry: p.laundry,
      air_conditioning: p.air_conditioning,
      balcony: p.balcony,
      furnished: p.furnished,
      pet_friendly: p.pet_friendly,
      pets_cats: p.pets_cats,
      pets_dogs: p.pets_dogs,
      pets_dog_size: p.pets_dog_size,
      pets_notes: p.pets_notes,
      heat_included: p.heat_included,
      hydro_included: p.hydro_included,
      water_included: p.water_included,
    },
  }).map((c) => ({
    key: c.portal,
    label: copyPortalLabel(c.portal),
    title: c.title,
    body: c.body,
  }));

  // Share-readiness checklist (QA Should-Fix #5): before the operator pastes
  // the public link onto Kijiji/Facebook, surface what's in place and what's
  // still missing. Shown for the states where you'd be prepping/sharing a unit
  // (Draft / Live / Paused); a retired (Off market) or Leased unit is past this.
  const showReadiness =
    p.status === "draft" || p.status === "available" || p.status === "paused";
  const readiness = buildShareReadiness({
    status: p.status,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    address: p.address,
    photoCount: photoRows.length,
    availabilityWindowCount: availabilityCount ?? 0,
    replyToEmail: org?.reply_to_email ?? null,
  });

  // Status-aware guardrail for the share tools (S226 QA-audit): warn the
  // operator before they hand out a link that won't behave the way they expect.
  //   available           -> fully live, no notice
  //   paused / leased      -> /r LOADS but says "not available" (caution)
  //   draft / off_market   -> /r 404s, the link is broken (warning)
  const shareNotice = isPublicBookable(p.status)
    ? null
    : isPubliclyVisible(p.status)
      ? {
          tone: "caution" as const,
          text:
            p.status === "leased"
              ? "This rental is marked Leased. The link still works, but anyone who opens it is told the unit is no longer available — they can't inquire or book a viewing."
              : "This rental is Paused. The link still works, but anyone who opens it is told the unit isn't currently available — they can't inquire or book a viewing.",
        }
      : {
          tone: "warning" as const,
          text: `This rental is a ${propertyStatusLabel(
            p.status,
          )}. Its public page isn't live yet — anyone you share the link with will hit a "not found" page. Set it to Live (below) before sharing.`,
        };

  return (
    <div>
      <Link
        href="/dashboard/properties"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Rentals
      </Link>

      {searchParams.saved && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Changes saved.
        </p>
      )}

      {searchParams.duplicated && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Copied from another rental. Update the address and rent below, then set
          it Live when you&apos;re ready. It&apos;s saved as a Draft for now, so
          renters can&apos;t see it.
        </p>
      )}

      {searchParams.imported && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Prefilled{" "}
          {Number(searchParams.imported) > 0
            ? `${searchParams.imported} ${
                Number(searchParams.imported) === 1 ? "field" : "fields"
              } `
            : ""}
          from your pasted listing. Review everything below — especially the
          address, rent, and pet policy — then set it Live when it&apos;s right.
          It&apos;s saved as a Draft for now, so renters can&apos;t see it yet.
        </p>
      )}

      {/* Close the onboarding loop (S247): a paste from MLS / realtor.ca brings
          the text but never the photos, and portals like Kijiji and Facebook
          need photos to perform. Right after an import, point the operator
          straight at the photo uploader. */}
      {searchParams.imported && photoRows.length === 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>Next: add photos.</strong> Your pasted listing didn&apos;t
          include any — and listings with photos get far more inquiries on
          Kijiji, Facebook, and Zumper.{" "}
          <a href="#property-photos" className="font-medium underline">
            Add photos →
          </a>
        </p>
      )}

      {blastedCount != null && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {blastedCount > 0
            ? `Price-drop alert sent to ${blastedCount} ${
                blastedCount === 1 ? "renter" : "renters"
              }.`
            : "No renters were eligible for a price-drop alert."}
        </p>
      )}

      {searchParams.post && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {searchParams.post === "added"
            ? "Listing post added."
            : searchParams.post === "removed"
              ? "Listing post removed."
              : "Listing post saved."}
        </p>
      )}

      {searchParams.posterr && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listingPostErrorMessage(searchParams.posterr)}
        </p>
      )}

      {searchParams.photos && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {searchParams.photos === "cover"
            ? "Cover photo updated."
            : searchParams.photos === "order"
              ? "Photo order updated."
              : searchParams.photos === "removed"
                ? "Photo removed."
                : `${searchParams.photos} ${
                    searchParams.photos === "1" ? "photo" : "photos"
                  } uploaded.`}
        </p>
      )}

      {searchParams.photoerr && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.photoerr === "type" ||
          searchParams.photoerr === "size" ||
          searchParams.photoerr === "empty"
            ? uploadErrorMessage(searchParams.photoerr)
            : searchParams.photoerr === "max"
              ? `You can add up to ${MAX_PHOTOS_PER_PROPERTY} photos per rental.`
              : searchParams.photoerr === "none"
                ? "Please choose at least one photo to upload."
                : "Sorry, the upload didn't go through. Please try again."}
        </p>
      )}

      <PageHeader
        icon={<Icons.building />}
        eyebrow="Rental"
        title={p.address}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${propertyStatusBadge(p.status).className}`}
            >
              {propertyStatusBadge(p.status).label}
            </span>
            {p.rent_cents ? (
              <span className="text-sm text-gray-500">
                ${(p.rent_cents / 100).toLocaleString()}/mo
              </span>
            ) : null}
            <form action={duplicateProperty}>
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" className={SECONDARY_ACTION_CLASS}>
                Duplicate this rental
              </button>
            </form>
          </div>
        }
      />

      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile size="sm"><Icons.link className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Public listing link
          </h3>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          {linkIsLive
            ? "Share this branded page on Kijiji, Facebook, and email. Inquiries land straight in your renter list."
            : "Once this rental is Live, its branded page can be shared on Kijiji, Facebook, and email and inquiries land straight in your renter list."}
        </p>
        {shareNotice && (
          <p
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              shareNotice.tone === "warning"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {shareNotice.text}
          </p>
        )}
        {/* Only expose Copy / Open when the link actually resolves. For a Draft
            or off-market rental the /r page 404s, so we show the warning above
            instead of a broken link (QA blocker #1). */}
        {linkIsLive && <CopyLink url={publicUrl} />}

        {showReadiness && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="mb-2.5 flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Before you share
              </h4>
              {readiness.readyToShare ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  Ready to share
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {readiness.requiredOutstanding}{" "}
                  {readiness.requiredOutstanding === 1 ? "thing" : "things"} to
                  finish
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {readiness.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden
                    className={`mt-px font-semibold ${
                      c.ok
                        ? "text-green-600"
                        : c.required
                          ? "text-amber-600"
                          : "text-gray-300"
                    }`}
                  >
                    {c.ok ? "✓" : "○"}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={
                        c.ok ? "text-gray-600" : "font-medium text-gray-900"
                      }
                    >
                      {c.label}
                    </span>
                    {!c.required && (
                      <span className="text-gray-400"> · recommended</span>
                    )}
                    {!c.ok && (
                      <span className="mt-0.5 block text-gray-500">
                        {c.hint}
                        {c.key === "photos" && (
                          <>
                            {" "}
                            <a
                              href="#property-photos"
                              className="font-medium text-brand underline"
                            >
                              Add photos →
                            </a>
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* --- Listing copy for each channel --- */}
      <ListingCopyCard tabs={copyTabs} />

      {/* --- Photos for this rental --- */}
      <div
        id="property-photos"
        className="mb-6 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Photos for this rental
          </h3>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Add photos renters will see on your listing page. The{" "}
          <strong>cover photo</strong> shows first. Drag isn&apos;t needed, just
          use the arrows to reorder. JPG, PNG, WebP, or GIF, up to 10&nbsp;MB each
          ({photoRows.length}/{MAX_PHOTOS_PER_PROPERTY}).
        </p>

        {photoRows.length === 0 ? (
          <div className="mb-4">
            <EmptyState
              icon={<Icons.page />}
              title="No photos yet"
              description="A listing with photos gets far more inquiries, so add a few below."
            />
          </div>
        ) : (
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photoRows.map((photo, i) => (
              <li
                key={photo.id}
                className="overflow-hidden rounded-xl border border-gray-200"
              >
                <div className="relative aspect-[4/3] bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {photo.is_cover && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
                      Cover
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <form action={movePhoto}>
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={i === 0}
                        aria-label="Move earlier"
                        className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ←
                      </button>
                    </form>
                    <form action={movePhoto}>
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={i === photoRows.length - 1}
                        aria-label="Move later"
                        className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        →
                      </button>
                    </form>
                  </div>
                  <div className="flex items-center gap-1">
                    {!photo.is_cover && (
                      <form action={setCoverPhoto}>
                        <input type="hidden" name="property_id" value={p.id} />
                        <input type="hidden" name="photo_id" value={photo.id} />
                        <button
                          type="submit"
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-gray-100"
                        >
                          Set cover
                        </button>
                      </form>
                    )}
                    <form action={deletePhoto}>
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <button
                        type="submit"
                        aria-label="Delete photo"
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {atPhotoLimit ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            You&apos;ve reached the {MAX_PHOTOS_PER_PROPERTY}-photo limit. Delete
            one to add another.
          </p>
        ) : (
          <form
            action={uploadPropertyPhotos}
            className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3"
          >
            <input type="hidden" name="property_id" value={p.id} />
            <input
              type="file"
              name="photos"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              required
              className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            />
            <button
              type="submit"
              className={PRIMARY_ACTION_CLASS}
              style={{ backgroundColor: "var(--brand-color)" }}
            >
              Upload photos
            </button>
          </form>
        )}
      </div>

      {/* --- Where this is posted (listing distribution / source tracking) --- */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile size="sm"><Icons.list className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Where this is posted
          </h3>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Track each portal you advertise on. Share that portal&apos;s{" "}
          <strong>tracked link</strong> instead of the plain one, and every
          inquiry through it is tagged with the channel it came from, so your
          reports show what&apos;s actually working.
        </p>

        {postRows.length === 0 ? (
          <div className="mb-4">
            <EmptyState
              icon={<Icons.list />}
              title="No posts tracked yet"
              description="Add the portals you've listed this unit on below to track inquiries by source."
            />
          </div>
        ) : (
          <ul className="mb-4 space-y-3">
            {postRows.map((post) => {
              const count = postCounts.get(post.id) ?? 0;
              const trackedUrl = buildTrackedLink(publicUrl, post.id);
              return (
                <li
                  key={post.id}
                  className="rounded-xl border border-gray-200 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {portalLabel(post.portal)}
                      {post.portal === "other" && post.label
                        ? ` · ${post.label}`
                        : ""}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        post.status === "live"
                          ? "bg-green-50 text-green-700"
                          : post.status === "draft"
                            ? "bg-gray-100 text-gray-600"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {listingPostStatusLabel(post.status)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {count} {count === 1 ? "inquiry" : "inquiries"}
                    </span>
                    {post.posted_on && (
                      <span className="text-xs text-gray-400">
                        posted {post.posted_on}
                      </span>
                    )}
                  </div>

                  <p className="mb-1 text-xs font-medium text-gray-500">
                    Tracked inquiry link for this portal
                  </p>
                  <CopyLink url={trackedUrl} />

                  {post.notes && (
                    <p className="mt-2 text-xs text-gray-500">{post.notes}</p>
                  )}

                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-brand">
                      Edit / remove
                    </summary>
                    <form
                      action={updateListingPost}
                      className="mt-3 space-y-3 border-t border-gray-100 pt-3"
                    >
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="post_id" value={post.id} />
                      <div className="flex flex-wrap gap-3">
                        <div className="w-44">
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            Portal
                          </label>
                          <select
                            name="portal"
                            defaultValue={post.portal}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          >
                            {PORTALS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-36">
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            Status
                          </label>
                          <select
                            name="status"
                            defaultValue={post.status}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          >
                            {LISTING_POST_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {listingPostStatusLabel(s)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-40">
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            Posted date
                          </label>
                          <input
                            name="posted_on"
                            type="date"
                            defaultValue={post.posted_on ?? ""}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          Ad URL
                        </label>
                        <input
                          name="url"
                          defaultValue={post.url ?? ""}
                          placeholder="https://www.kijiji.ca/..."
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <p className="mt-1 text-xs text-gray-400">
                          Required once the post is Live, so its tracked link
                          works.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <div className="flex-1 min-w-[12rem]">
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            Label{" "}
                            <span className="font-normal text-gray-400">
                              (for &quot;Other&quot;)
                            </span>
                          </label>
                          <input
                            name="label"
                            defaultValue={post.label ?? ""}
                            placeholder="PadMapper"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="flex-1 min-w-[12rem]">
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            Notes
                          </label>
                          <input
                            name="notes"
                            defaultValue={post.notes ?? ""}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        className={PRIMARY_ACTION_CLASS}
                        style={{ backgroundColor: "var(--brand-color)" }}
                      >
                        Save post
                      </button>
                    </form>
                    <form action={removeListingPost} className="mt-2">
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="post_id" value={post.id} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Remove this post
                      </button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">
            + Add a post
          </summary>
          <form
            // Keyed on the post-submit nonce so a successful add REMOUNTS this
            // form and clears its uncontrolled inputs (S226 QA-audit form-reset).
            key={`add-post-${searchParams.pn ?? "new"}`}
            action={addListingPost}
            className="mt-3 space-y-3 border-t border-gray-100 pt-3"
          >
            <input type="hidden" name="property_id" value={p.id} />
            <div className="flex flex-wrap gap-3">
              <div className="w-44">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Portal
                </label>
                <select
                  name="portal"
                  defaultValue="kijiji"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {PORTALS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-36">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Status
                </label>
                <select
                  name="status"
                  defaultValue="live"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {LISTING_POST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {listingPostStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-40">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Posted date
                </label>
                <input
                  name="posted_on"
                  type="date"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Ad URL
              </label>
              <input
                name="url"
                placeholder="https://www.kijiji.ca/..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">
                Required once the post is Live, so its tracked link works.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[12rem]">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Label{" "}
                  <span className="font-normal text-gray-400">
                    (for &quot;Other&quot;)
                  </span>
                </label>
                <input
                  name="label"
                  placeholder="PadMapper"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex-1 min-w-[12rem]">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Notes
                </label>
                <input
                  name="notes"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              className={PRIMARY_ACTION_CLASS}
              style={{ backgroundColor: "var(--brand-color)" }}
            >
              Add post
            </button>
          </form>
        </details>
      </div>

      {showBlastCard && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="mb-1 text-sm font-semibold text-amber-900">
            Price dropped - notify past renters
          </h3>
          <p className="mb-3 text-xs text-amber-800">
            You reduced the rent from{" "}
            <span className="line-through">
              {formatRentLabel(p.price_drop_pending_cents)}
            </span>{" "}
            to <strong>{formatRentLabel(p.rent_cents)}</strong>.{" "}
            {eligibleCount} {eligibleCount === 1 ? "renter" : "renters"} who
            inquired earlier {eligibleCount === 1 ? "hasn't" : "haven't"} been
            told yet. Email them a branded alert with a link back to the listing.
          </p>
          <form action={blastPriceDrop}>
            <input type="hidden" name="id" value={p.id} />
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Notify {eligibleCount}{" "}
              {eligibleCount === 1 ? "renter" : "renters"} of the price drop
            </button>
          </form>
        </div>
      )}

      <form
        action={updateProperty}
        className="mb-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
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
        <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          <summary className="cursor-pointer font-medium text-gray-600">
            What each status means
          </summary>
          <ul className="mt-2 space-y-1.5">
            {PROPERTY_STATUSES.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-medium ${propertyStatusBadge(s).className}`}
                >
                  {propertyStatusLabel(s)}
                </span>
                <span>{propertyStatusHelp(s)}</span>
              </li>
            ))}
          </ul>
        </details>
        <DescriptionGuide
          defaultValue={p.description ?? ""}
          facts={{
            beds: p.beds,
            baths: p.baths,
            sqft: p.sqft,
            floor: p.floor,
            parking: p.parking,
            laundry: p.laundry,
            air_conditioning: p.air_conditioning,
            balcony: p.balcony,
            furnished: p.furnished,
            pet_friendly: p.pet_friendly,
            pets_cats: p.pets_cats,
            pets_dogs: p.pets_dogs,
            pets_dog_size: p.pets_dog_size,
            pets_notes: p.pets_notes,
            heat_included: p.heat_included,
            hydro_included: p.hydro_included,
            water_included: p.water_included,
            available_date: p.available_date,
            rent_cents: p.rent_cents,
          }}
        />

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

          {/* --- Pets (structured policy, migration 0045) --- */}
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <p className="mb-2 text-xs font-medium text-gray-600">Pets welcome</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {(
                [
                  ["pets_cats", "Cats", p.pets_cats],
                  ["pets_dogs", "Dogs", p.pets_dogs],
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
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Dog size limit</label>
                <select
                  name="pets_dog_size"
                  defaultValue={p.pets_dog_size ?? ""}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">No limit</option>
                  {DOG_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {dogSizeLabel(opt)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <input
              name="pets_notes"
              defaultValue={p.pets_notes ?? ""}
              placeholder="Pet notes (optional), e.g. 1 pet max, no aggressive breeds"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">
              Advertised pet preference for the listing and feed. In Ontario a
              &ldquo;no pets&rdquo; lease clause is void (RTA s.14) — this is a
              listing/screening field, not an enforceable rule.
            </p>
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
          className={PRIMARY_ACTION_CLASS}
          style={{ backgroundColor: "var(--brand-color)" }}
        >
          Save changes
        </button>
      </form>

      <SectionHeading>
        Inquiries for this rental ({leadRows.length})
      </SectionHeading>
      {leadRows.length === 0 ? (
        <EmptyState
          icon={<Icons.users />}
          title="No inquiries yet"
          description={
            linkIsLive
              ? "Share the public listing link above to start collecting inquiries."
              : "Set this rental to Live (in the form above) to share its public link and start collecting inquiries."
          }
        />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {leadRows.map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <span className="text-gray-900">
                  {l.name || l.email || "Unnamed renter"}
                </span>
                <StatusChip tone={leadStatusTone(l.status)}>
                  {statusLabel(l.status)}
                </StatusChip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
